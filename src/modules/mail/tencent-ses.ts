/**
 * 腾讯云邮件推送（SES）HTTP API 驱动：SendEmail（模板发送，触发类）。
 * TC3-HMAC-SHA256 签名手写实现（约 40 行），不引官方 SDK（AGENTS 依赖最小化）。
 * 请求/响应形状以官方 SDK 模型为准：Template { TemplateID: number, TemplateData: string }。
 */
import { createHash, createHmac } from 'node:crypto';
import { MAIL_SUBJECTS, MailKind, MailVars } from './mail.types';

export interface TencentSesConfig {
  secretId: string;
  secretKey: string;
  region: string;
  from: string;
  templateIds: Record<MailKind, number>;
}

function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** TC3-HMAC-SHA256 签名（腾讯云 API 3.0 通用签名过程） */
function buildAuthorization(
  secretId: string,
  secretKey: string,
  service: string,
  host: string,
  action: string,
  payload: string,
  timestamp: number,
  region: string,
): { authorization: string; headers: Record<string, string> } {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = 'application/json; charset=utf-8';
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(payload)}`;
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign).toString('hex');
  return {
    authorization:
      `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    headers: {
      'Content-Type': contentType,
      Host: host,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': '2020-10-02',
      'X-TC-Region': region,
    },
  };
}

/** 发送失败抛错（由队列 worker 重试）；错误信息不含收件人与正文 */
export async function sendViaTencentSes(
  cfg: TencentSesConfig,
  to: string,
  kind: MailKind,
  vars: MailVars,
): Promise<void> {
  const host = 'ses.tencentcloudapi.com';
  const action = 'SendEmail';
  const body = JSON.stringify({
    FromEmailAddress: cfg.from,
    // 主题支持模板变量填充（官方约定），变量取值随 TemplateData
    Subject: MAIL_SUBJECTS[kind],
    Destination: [to],
    Template: {
      TemplateID: cfg.templateIds[kind],
      TemplateData: JSON.stringify(vars),
    },
    // 触发类：验证码/重置等即时事务邮件走触发通道
    TriggerType: 1,
    // 退订链接由站内自建（token 化一键退订），不叠加平台退订
    Unsubscribe: '0',
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const { authorization, headers } = buildAuthorization(
    cfg.secretId,
    cfg.secretKey,
    'ses',
    host,
    action,
    body,
    timestamp,
    cfg.region,
  );
  const res = await fetch(`https://${host}`, { method: 'POST', headers: { ...headers, Authorization: authorization }, body });
  const text = await res.text();
  let ok = res.ok;
  let requestId = '';
  let message = '';
  try {
    const json = JSON.parse(text) as {
      Response?: { Error?: { Code?: string; Message?: string }; RequestId?: string };
    };
    requestId = json.Response?.RequestId ?? '';
    if (json.Response?.Error) {
      ok = false;
      message = json.Response.Error.Message ?? '';
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error(`ses send failed: status=${res.status} request_id=${requestId} msg=${message.slice(0, 200)}`);
  }
}
