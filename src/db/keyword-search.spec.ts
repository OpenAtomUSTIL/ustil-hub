import { authorIdsMatchingKeyword } from './keyword-search';

/** 生成 SQL 即断言口径（不需要真实连接）：只触用户名/昵称列 + ACTIVE 过滤 */
describe('authorIdsMatchingKeyword（站内搜索作者扩展口径）', () => {
  it('仅按用户名/昵称匹配、排除封禁；email/phone 等密文列不参与检索（v10.0 红线）', () => {
    const { sql, params } = authorIdsMatchingKeyword('bob').toSQL();

    expect(sql).toContain('"username"');
    expect(sql).toContain('"nickname"');
    expect(sql).not.toContain('"email"');
    expect(sql).not.toContain('"phone"');
    expect(sql).toContain('"status"');
    expect(params).toEqual(expect.arrayContaining(['ACTIVE', '%bob%']));
  });

  it('关键词按 %kw% 包裹（前后模糊匹配）', () => {
    const { params } = authorIdsMatchingKeyword('张三').toSQL();
    expect(params).toContain('%张三%');
  });
});
