import { IsBoolean } from 'class-validator';

/** 通知邮件偏好（v12.0）：总开关，默认关 */
export class UpdateNoticePrefDto {
  @IsBoolean({ message: 'emailNoticeEnabled 必须是布尔值' })
  emailNoticeEnabled!: boolean;
}
