/**
 * 本地模板渲染（SMTP 驱动用）。
 * 内容与 docs/mail-templates/（腾讯云 SES 控制台已过审版本）保持一致：
 * 链接一律「固定域名 + 路径变量」形态（腾讯模板审核规范）。改动需两处同步。
 */
import { MAIL_SUBJECTS, MailKind, MailVars } from './mail.types';

const LINK_BASE = 'https://forum.openatomustil.cn';

function interpolate(template: string, vars: MailVars): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

function layout(contentRows: string, footerExtra = ''): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0; padding:0; background-color:#f5f4ed; font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Helvetica Neue',Arial,sans-serif; color:#141413;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#f5f4ed;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" border="0" cellpadding="0" cellspacing="0" style="width:100%; max-width:600px; background-color:#ffffff; border:1px solid #e3dacc; border-radius:16px;">
          <tr>
            <td style="padding:28px 36px 0;">
              <span style="font-family:Georgia,'Times New Roman','Songti SC',serif; font-size:21px;">USTIL 开放论坛</span>
              <span style="display:inline-block; width:26px; height:3px; background-color:#d97757; vertical-align:middle; margin:0 0 4px 10px;"></span>
            </td>
          </tr>
          ${contentRows}
          <tr>
            <td style="border-top:1px solid #e3dacc; padding:22px 36px 30px;">
              <p style="margin:0; font-size:12px; line-height:1.9; color:#87867f;">
                ${footerExtra ? `${footerExtra}<br>` : ''}
                本邮件由系统自动发送，请勿直接回复。<br>
                © 2026 开放原子 USTIL 学生开源社区 · <a href="${LINK_BASE}" style="color:#c46849; text-decoration:none;">forum.openatomustil.cn</a> · 辽ICP备2026004720号
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const FOOTER_NOTE = '本邮件是站内通知的邮件副本。你可以在「个人中心 → 通知设置」中随时关闭邮件提醒。';

function buttonRow(label: string, pathVar: string, vars: MailVars): string {
  return `<tr>
            <td align="center" style="padding:24px 36px 8px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:#c6613f; border-radius:12px;">
                    <a href="${LINK_BASE}/${vars[pathVar] ?? ''}" style="display:inline-block; padding:13px 34px; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none;">${label}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

const HTML_TEMPLATES: Record<MailKind, (vars: MailVars) => string> = {
  'verify-code': (vars) =>
    layout(`<tr>
            <td style="padding:24px 36px 0;">
              <h1 style="margin:0; font-size:22px; font-weight:600;">邮箱验证码</h1>
              <p style="margin:16px 0 0; font-size:15px; line-height:1.8; color:#3d3d3a;">你正在${vars.purpose ?? ''}，验证码如下：</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 36px;">
              <div style="background-color:#faf9f5; border:1px solid #e3dacc; border-radius:12px; padding:22px 16px; font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace; font-size:32px; font-weight:700; letter-spacing:10px; color:#c46849;">${vars.code ?? ''}</div>
              <p style="margin:16px 0 0; font-size:13px; color:#87867f;">${vars.expiresMinutes ?? ''} 分钟内有效，只能使用一次。</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 36px 30px;">
              <p style="margin:0; font-size:13px; line-height:1.8; color:#87867f;">若非本人操作，请忽略本邮件。验证码过期后不会生效，也无法被他人使用。</p>
            </td>
          </tr>`),
  'reset-password': (vars) =>
    layout(`<tr>
            <td style="padding:24px 36px 0;">
              <h1 style="margin:0; font-size:22px; font-weight:600;">重置密码</h1>
              <p style="margin:16px 0 0; font-size:15px; line-height:1.8; color:#3d3d3a;">我们收到了重置该账号密码的申请。点击下面的按钮设置新密码：</p>
            </td>
          </tr>
          ${buttonRow('立即重置密码', 'resetPath', vars)}
          <tr>
            <td style="padding:14px 36px 0;">
              <p style="margin:0; font-size:13px; line-height:1.8; color:#87867f;">
                如果按钮无法点击，请复制以下链接到浏览器打开：<br>
                <a href="${LINK_BASE}/${vars.resetPath ?? ''}" style="color:#c46849; word-break:break-all;">${LINK_BASE}/${vars.resetPath ?? ''}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 36px 30px;">
              <p style="margin:0; font-size:13px; line-height:1.8; color:#87867f;">链接 ${vars.expiresMinutes ?? ''} 分钟内有效，且只能使用一次。若非本人操作，请忽略本邮件——你的密码不会被更改。</p>
            </td>
          </tr>`),
  'notice-reply': (vars) =>
    layout(
      `<tr>
            <td style="padding:24px 36px 0;">
              <h1 style="margin:0; font-size:22px; font-weight:600;">${vars.actorNickname ?? ''} 回复了你的${vars.scope ?? ''}</h1>
              <p style="margin:16px 0 0; font-size:15px; line-height:1.8; color:#3d3d3a;">在《${vars.contentTitle ?? ''}》中：</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 36px 0;">
              <div style="background-color:#faf9f5; border-left:3px solid #d97757; border-radius:0 8px 8px 0; padding:16px 18px; font-size:14px; line-height:1.9; color:#3d3d3a;">${vars.replyExcerpt ?? ''}</div>
            </td>
          </tr>
          ${buttonRow('查看完整回复', 'actionPath', vars)}
          <tr>
            <td style="padding:18px 36px 30px;">
              <p style="margin:0; font-size:13px; line-height:1.8; color:#87867f;">${FOOTER_NOTE}</p>
            </td>
          </tr>`,
      `不想再收到此类邮件？<a href="${LINK_BASE}/${vars.unsubscribePath ?? ''}" style="color:#c46849; text-decoration:none;">一键退订</a>`,
    ),
  'notice-generic': (vars) =>
    layout(
      `<tr>
            <td style="padding:24px 36px 0;">
              <h1 style="margin:0; font-size:22px; font-weight:600;">${vars.title ?? ''}</h1>
              <p style="margin:16px 0 0; font-size:15px; line-height:1.8; color:#3d3d3a;">${vars.summary ?? ''}</p>
            </td>
          </tr>
          ${buttonRow('查看详情', 'actionPath', vars)}
          <tr>
            <td style="padding:18px 36px 30px;">
              <p style="margin:0; font-size:13px; line-height:1.8; color:#87867f;">${FOOTER_NOTE}</p>
            </td>
          </tr>`,
      `不想再收到此类邮件？<a href="${LINK_BASE}/${vars.unsubscribePath ?? ''}" style="color:#c46849; text-decoration:none;">一键退订</a>`,
    ),
};

const TEXT_TEMPLATES: Record<MailKind, (vars: MailVars) => string> = {
  'verify-code': (vars) => `你正在${vars.purpose ?? ''}，验证码如下：

  ${vars.code ?? ''}

${vars.expiresMinutes ?? ''} 分钟内有效，只能使用一次。

若非本人操作，请忽略本邮件。验证码过期后不会生效，也无法被他人使用。`,
  'reset-password': (vars) => `我们收到了重置该账号密码的申请。打开下面的链接设置新密码：

${LINK_BASE}/${vars.resetPath ?? ''}

链接 ${vars.expiresMinutes ?? ''} 分钟内有效，且只能使用一次。

若非本人操作，请忽略本邮件——你的密码不会被更改。`,
  'notice-reply': (vars) => `${vars.actorNickname ?? ''} 在《${vars.contentTitle ?? ''}》中回复了你：

  「${vars.replyExcerpt ?? ''}」

查看完整回复：
${LINK_BASE}/${vars.actionPath ?? ''}

${FOOTER_NOTE}
不想再收到此类邮件？一键退订：${LINK_BASE}/${vars.unsubscribePath ?? ''}`,
  'notice-generic': (vars) => `${vars.title ?? ''}

${vars.summary ?? ''}

查看详情：
${LINK_BASE}/${vars.actionPath ?? ''}

${FOOTER_NOTE}
不想再收到此类邮件？一键退订：${LINK_BASE}/${vars.unsubscribePath ?? ''}`,
};

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export function renderTemplate(kind: MailKind, vars: MailVars): RenderedMail {
  return {
    subject: interpolate(MAIL_SUBJECTS[kind], vars),
    html: HTML_TEMPLATES[kind](vars),
    text: TEXT_TEMPLATES[kind](vars),
  };
}
