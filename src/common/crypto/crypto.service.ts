import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const CRYPTO_MASTER_KEY = 'CRYPTO_MASTER_KEY';

/** 信封 token：v1.<cryptoId>.<encryptedAtMs>.<base64url(iv|tag|ciphertext)>（v10.0 用户标识 + 加密信息 + 哈希） */
const TOKEN_VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * 个人信息信封加密（v10.0）：AES-256-GCM，每用户密钥由 HKDF(masterKey, salt=cryptoId) 派生。
 * 时间戳不作密钥（可预测），随 token 内嵌并进 AAD——认证覆盖用途域/用户标识/时间戳，
 * 防跨字段替换与跨用户挪用；「哈希」由 GCM 认证标签承担完整性校验。
 */
@Injectable()
export class CryptoService {
  private readonly masterKey: Buffer;

  constructor(@Inject(CRYPTO_MASTER_KEY) masterKeyBase64: string) {
    const key = Buffer.from(masterKeyBase64 ?? '', 'base64');
    if (key.length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY 必须是 32 字节的 base64（node -e 生成：require("crypto").randomBytes(32).toString("base64")）');
    }
    this.masterKey = key;
  }

  /** 每用户标识：16 字节随机 → 32 位十六进制小写（绝对唯一，生成后不变） */
  newCryptoId(): string {
    return randomBytes(16).toString('hex');
  }

  private dataKey(cryptoId: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.masterKey, Buffer.from(cryptoId, 'hex'), Buffer.from('ustil-pii-v1'), 32));
  }

  /** 精确查找列用 HMAC（不可逆、确定性）：同值必同 HMAC，跨环境 masterKey 不同则不可比 */
  hmac(plaintext: string): string {
    return createHmac('sha256', this.masterKey).update(`ustil-lookup-v1:${plaintext}`).digest('hex');
  }

  /** 加密：null/空串直通（空值不是 PII）；返回信封 token */
  seal(purpose: string, plaintext: string | null | undefined, cryptoId: string): string | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;
    const iv = randomBytes(IV_BYTES);
    const encryptedAt = Date.now();
    const aad = Buffer.from(`${TOKEN_VERSION}|${purpose}|${cryptoId}|${encryptedAt}`, 'utf8');
    const cipher = createCipheriv('aes-256-gcm', this.dataKey(cryptoId), iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
    return `${TOKEN_VERSION}.${cryptoId}.${encryptedAt}.${payload}`;
  }

  /** 解密：非 token 形态/版本不符/校验失败一律返回 null（拒绝半解密） */
  open(purpose: string, token: string | null | undefined, cryptoId: string): string | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 4) return null;
    const [version, tokenCryptoId, timestamp, payload] = parts;
    // 防跨用户挪信封：token 的用户标识必须与目标行一致
    if (version !== TOKEN_VERSION || tokenCryptoId !== cryptoId) return null;
    const encryptedAt = Number(timestamp);
    if (!Number.isSafeInteger(encryptedAt) || encryptedAt <= 0) return null;
    const raw = Buffer.from(payload, 'base64url');
    if (raw.length < IV_BYTES + TAG_BYTES + 1) return null;
    const iv = raw.subarray(0, IV_BYTES);
    const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
    const aad = Buffer.from(`${TOKEN_VERSION}|${purpose}|${cryptoId}|${encryptedAt}`, 'utf8');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.dataKey(cryptoId), iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // 篡改/跨用途替换/错误密钥：统一拒绝，不泄露细节
      return null;
    }
  }

  /** 定值比较（如需比对 HMAC，防时序侧信道） */
  hmacEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
