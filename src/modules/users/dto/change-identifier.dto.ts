import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CaptchaFields } from '../../../common/dto/captcha-fields';

export class ChangeIdentifierDto extends CaptchaFields {
  @IsIn(['email', 'phone'], { message: 'type 必须是 email 或 phone' })
  type!: 'email' | 'phone';

  @IsString({ message: 'value 必须是字符串' })
  @IsNotEmpty({ message: 'value 不能为空' })
  @MaxLength(255, { message: 'value 过长' })
  value!: string;

  @IsString({ message: 'password 必须是字符串' })
  @IsNotEmpty({ message: 'password 不能为空' })
  password!: string;

  // v12.0：换绑邮箱必须携带新邮箱的邮件验证码（purpose=rebind）；绑手机号不需要
  @ValidateIf((o: ChangeIdentifierDto) => o.type === 'email')
  @IsString({ message: '验证码必须是字符串' })
  @IsNotEmpty({ message: '验证码不能为空' })
  @MaxLength(16, { message: '验证码过长' })
  emailCode?: string;
}
