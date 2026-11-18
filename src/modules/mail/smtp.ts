/**
 * SMTP 驱动（对接腾讯云 SES 的 SMTP 接口 smtp.qcloudmail.com 或任意中继）。
 * 正文用本地模板渲染（docs/mail-templates 同步副本），主题/HTML/纯文本三件套发送。
 */
import { createTransport, Transporter } from 'nodemailer';
import { MailKind, MailVars } from './mail.types';
import { renderTemplate } from './templates';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

let transporter: Transporter | null = null;

function getTransporter(cfg: SmtpConfig): Transporter {
  if (!transporter) {
    transporter = createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }
  return transporter;
}

export async function sendViaSmtp(cfg: SmtpConfig, to: string, kind: MailKind, vars: MailVars): Promise<void> {
  const rendered = renderTemplate(kind, vars);
  await getTransporter(cfg).sendMail({
    from: cfg.from,
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}
