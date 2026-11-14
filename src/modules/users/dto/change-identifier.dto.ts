import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
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
}
