/** 邮件模板种类（与腾讯云 SES 控制台已过审模板一一对应） */
export type MailKind = 'verify-code' | 'reset-password' | 'notice-reply' | 'notice-generic';

/** 模板变量（值一律字符串；腾讯 TemplateData 约定值不能是 HTML 等复杂类型） */
export type MailVars = Record<string, string>;

/** 队列任务载荷（不含收件人明文以外的 PII；任务体不落日志） */
export interface MailJobData {
  to: string;
  kind: MailKind;
  vars: MailVars;
}

export const MAIL_QUEUE_NAME = 'mail';

/** 通知邮件收件人（users 模块解析后输出；邮箱明文只在传输给发信层的瞬间存在） */
export interface MailRecipient {
  userId: string;
  email: string;
  nickname: string;
}

/** 跨模块收件人解析器 token（users 模块提供，notifications 模块消费；避免 service 层循环依赖） */
export const MAIL_RECIPIENT_RESOLVER = 'MAIL_RECIPIENT_RESOLVER';
export type MailRecipientResolver = (userIds: string[]) => Promise<MailRecipient[]>;

/** 模板主题（与 docs/mail-templates/*.txt 首行一致；{{var}} 由发送时变量填充） */
export const MAIL_SUBJECTS: Record<MailKind, string> = {
  'verify-code': '【USTIL 开放论坛】邮箱验证码',
  'reset-password': '【USTIL 开放论坛】重置密码',
  'notice-reply': '【USTIL 开放论坛】{{actorNickname}} 回复了你的{{scope}}',
  'notice-generic': '【USTIL 开放论坛】{{title}}',
};
