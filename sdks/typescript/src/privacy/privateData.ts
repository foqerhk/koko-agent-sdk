/** Match metadata and page headings only, never inspect secret field values. */
export type PrivateDataKind = 'recovery_phrase' | 'private_key' | 'account_secret' | 'financial_data' | 'identity_data';

export const RECOVERY_METADATA = /助[记記][词詞]|恢复短语|恢復短語|种子短语|種子短語|账户恢复凭证|敏感恢复数据|mnemonic|(?:recovery|seed)[\s_-]*(?:phrase|words?)/i;
export const RECOVERY_CELL = /(?:phrase[-_]?index|(?:mnemonic|recovery[-_]?phrase|seed)[-_]?(?:word|cell)[-_]?)\d+/i;

export function privateFieldKind(metadata: string): PrivateDataKind | null {
  if (RECOVERY_METADATA.test(metadata)) return 'recovery_phrase';
  if (/私[钥鑰]|private[\s_-]*key/i.test(metadata)) return 'private_key';
  if (/keystore|api[\s_-]*(?:key|secret)|access[\s_-]*token|refresh[\s_-]*token|(?:recovery|backup)[\s_-]*code|totp[\s_-]*(?:key|secret)|authenticator[\s_-]*(?:key|secret)|恢复码|备用码|API密钥|认证密钥/i.test(metadata)) return 'account_secret';
  if (/银行卡号|信用卡号|银行账号|银行账户号码|card[\s_-]*(?:number|security[\s_-]*code)|bank[\s_-]*(?:account|number)|\bcvv\b|\bcvc\b|\biban\b/i.test(metadata)) return 'financial_data';
  if (/身份证|身份證|证件号码|護照|护照|税号|passport|national[\s_-]*id|identity[\s_-]*(?:number|document)|social[\s_-]*security|\bssn\b|tax[\s_-]*id/i.test(metadata)) return 'identity_data';
  return null;
}

export function privateHeadingKind(value: string): PrivateDataKind | null {
  const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim().replace(/[：:？?！!。.]$/, '').trim();
  if (/^(?:(?:请)?(?:输入|导入|恢复|验证|确认|备份|显示|查看|记录|抄写|保存)(?:好|下)?(?:您的|你的|钱包的)?|(?:您的|你的|钱包的))?(?:助记词|助記詞|恢复短语|恢復短語|种子短语|種子短語|账户恢复凭证|敏感恢复数据)(?:\s*\(?\s*(?:12|15|18|21|24)\s*(?:个|個|词|詞|words?)\s*\)?)?$/i.test(text) ||
      /^(?:(?:please\s+)?(?:enter|import|restore|verify|confirm|back\s*up|backup|show|reveal|record|write\s+down|save)\s+)?(?:(?:your|the|secret)\s+)*(?:recovery\s+phrase|seed\s+(?:phrase|words)|mnemonic(?:\s+(?:phrase|words))?)(?:\s*\(?\s*(?:12|15|18|21|24)\s+words\s*\)?)?$/i.test(text)) return 'recovery_phrase';
  if (/^(?:(?:导出|显示|查看|输入|导入)(?:您的|你的)?私[钥鑰]|私[钥鑰]|(?:(?:export|show|reveal|import|enter)\s+)?(?:(?:your|the)\s+)?private\s*key)$/i.test(text)) return 'private_key';
  if (/^(?:恢复码|备用码|认证密钥|API密钥|(?:导出|导入|显示|查看)\s*keystore|keystore(?:\s+json)?|(?:show|export|import)\s+(?:api\s+(?:key|secret)|keystore)|(?:your\s+)?(?:recovery|backup)\s+codes|authenticator\s+(?:setup|secret|key)|set\s+up\s+(?:an\s+)?authenticator|设置身份验证器)$/i.test(text)) return 'account_secret';
  if (/^(?:填写银行卡信息|输入银行卡信息|银行卡信息|信用卡信息|enter\s+(?:your\s+)?card\s+details|card\s+details)$/i.test(text)) return 'financial_data';
  if (/^(?:身份认证|身份验证|实名认证|提交身份资料|证件信息|人脸验证|KYC验证|identity\s+verification|verify\s+(?:your\s+)?identity|submit\s+identity\s+documents|KYC\s+verification)$/i.test(text)) return 'identity_data';
  return null;
}
