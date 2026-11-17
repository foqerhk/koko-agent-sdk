import type { ViewNode } from '../types';
import { isSdkChrome, nodeLabels, staticScreenLabels } from './screenEvidence';

export type IndustryGateKind = 'web3_signature' | 'web3_authorization' | 'financial_transaction' | 'account_change';

/** Actual requests and final commitments; a feature name in a menu is not a request. */
export function industryUserGate(root: ViewNode): { kind: IndustryGateKind; nodeId: string } | null {
  const headings = staticScreenLabels(root);
  const classify = (text: string): IndustryGateKind | null => {
    const label = text.trim().replace(/[：:？?！!。.]$/, '').trim();
    if (/^(?:签名请求|请求签名|签署消息|签名消息|消息签名|交易签名|签署交易|签署类型化数据|signature\s+request|sign\s+(?:a\s+)?(?:message|transaction|typed\s+data)|personal_sign|eth_sign(?:TypedData(?:_v[134])?)?)$/i.test(label)) return 'web3_signature';
    if (/^(?:授权请求|代币授权|授权额度|无限授权|NFT授权|连接请求|请求连接钱包|token\s+approval|approve\s+(?:token|tokens|all\s+NFTs)|spending\s+(?:cap|limit)|unlimited\s+approval|permit2?|setApprovalForAll|connection\s+request|wallet\s+connection\s+request)$/i.test(label)) return 'web3_authorization';
    if (/^(?:确认转账|确认支付|确认付款|确认提现|提现确认|确认兑换|兑换确认|确认跨链|跨链确认|确认质押|质押确认|解除质押确认|交易确认|确认交易|广播交易|确认订单|订单确认|确认购买|确认出售|开通自动扣款|订阅确认|(?:confirm|review)\s+(?:transfer|payment|withdrawal|swap|bridge|stake|unstake|transaction|order|purchase|sale|subscription)|(?:transfer|payment|withdrawal|swap|transaction)\s+(?:confirmation|request)|direct\s+debit\s+authorization|recurring\s+payment)$/i.test(label)) return 'financial_transaction';
    if (/^(?:删除钱包|删除账户|删除账号|注销账户|注销账号|永久删除|重置钱包|重置账户|关闭双重验证|关闭两步验证|移除验证器|删除通行密钥|添加通行密钥|更改恢复邮箱|账户恢复|恢复账户|(?:delete|remove|reset)\s+(?:wallet|account|passkey|authenticator)|(?:disable|turn\s+off)\s+(?:2FA|two[- ]factor\s+authentication)|(?:add|create)\s+(?:a\s+)?passkey|change\s+recovery\s+(?:email|phone)|account\s+recovery)$/i.test(label)) return 'account_change';
    return null;
  };
  for (const { node, label } of headings) {
    const kind = classify(label);
    if (kind) return { kind, nodeId: node.id };
  }
  const controls: Array<{ node: ViewNode; label: string }> = [];
  const visit = (node: ViewNode) => {
    if (node.visible === false || isSdkChrome(node)) return;
    if (node.clickable && node.enabled !== false) for (const label of nodeLabels(node)) controls.push({ node, label });
    for (const child of node.children) visit(child);
  };
  visit(root);
  for (const { node, label } of controls) {
    // These labels describe the commitment itself, not a generic section entry.
    if (/^(?:确认(?:转账|付款|支付|交易|签名|授权|提现|兑换|跨链|质押)|签署并发送|广播交易|删除钱包|注销账户|永久删除|confirm\s+(?:transfer|payment|transaction|signature|approval|withdrawal|swap|bridge|stake)|sign\s+and\s+send|broadcast\s+transaction|delete\s+wallet|delete\s+account|delete\s+permanently)$/i.test(label)) {
      return { kind: /签|sign/i.test(label) ? 'web3_signature' : /授权|approval/i.test(label) ? 'web3_authorization' : /删除|注销|delete/i.test(label) ? 'account_change' : 'financial_transaction', nodeId: node.id };
    }
  }
  const details = headings.map(({ label }) => label).join(' ');
  const commit = controls.find(({ label }) => /^(?:签名|批准|授权|确认|支付|付款|发送|兑换|跨链|质押|解除质押|sign|approve|authorize|confirm|pay(?:\s+now)?|send(?:\s+now)?|swap|bridge|stake|unstake)$/i.test(label));
  if (commit && /spender|allowance|spending\s+cap|permit2|授权额度|被授权方|授权合约/i.test(details)) return { kind: 'web3_authorization', nodeId: commit.node.id };
  if (commit && /personal_sign|eth_signTypedData|待签名|签名内容|message\s+to\s+sign|typed\s+data/i.test(details)) return { kind: 'web3_signature', nodeId: commit.node.id };
  if (commit && /收款人|收款地址|应付金额|订单合计|recipient|payee|order\s+total/i.test(details) && /手续费|网络费用|gas\s+fee|network\s+fee|确认支付|payment\s+method/i.test(details)) return { kind: 'financial_transaction', nodeId: commit.node.id };
  return null;
}
