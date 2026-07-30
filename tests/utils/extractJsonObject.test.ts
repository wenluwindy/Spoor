import { describe, it, expect } from 'vitest';
import { extractFirstJsonObject } from '../../src/utils/extractJsonObject';

describe('extractFirstJsonObject', () => {
  it('干净的 JSON 直接解析', () => {
    expect(extractFirstJsonObject('{"action":"answer"}')).toEqual({ action: 'answer' });
  });

  it('前后空白无所谓', () => {
    expect(extractFirstJsonObject('\n  {"a":1}\n')).toEqual({ a: 1 });
  });

  it('剥掉 ```json 围栏', () => {
    expect(extractFirstJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('剥掉不带语言标记的围栏', () => {
    expect(extractFirstJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('前后带解释时取首个 { 到末个 }', () => {
    expect(extractFirstJsonObject('好的，结果如下：{"a":1}，如上。')).toEqual({ a: 1 });
  });

  it('嵌套对象不会被截断', () => {
    expect(extractFirstJsonObject('说明 {"a":{"b":[1,2]}} 结束')).toEqual({ a: { b: [1, 2] } });
  });

  it('没有 JSON 时抛 json_object', () => {
    expect(() => extractFirstJsonObject('抱歉，我不确定。')).toThrow('json_object');
  });

  it('空串抛错而不是返回 undefined', () => {
    expect(() => extractFirstJsonObject('')).toThrow('json_object');
  });

  it('残缺 JSON 抛错', () => {
    expect(() => extractFirstJsonObject('{"a": ')).toThrow();
  });
});
