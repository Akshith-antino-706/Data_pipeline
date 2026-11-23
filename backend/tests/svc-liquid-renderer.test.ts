import { describe, it, expect } from 'vitest';
import { Liquid } from 'liquidjs';
import LiquidRenderer from '../src/services/LiquidRenderer.js';

describe('LiquidRenderer.render', () => {
  it.each([null, undefined, ''])('returns empty string for %s template', async (t) => {
    expect(await LiquidRenderer.render(t)).toBe('');
  });

  it('renders variables', async () => {
    expect(await LiquidRenderer.render('Hi {{ name }}!', { name: 'Ali' })).toBe('Hi Ali!');
  });

  it('defaults vars to {} and renders missing vars as empty', async () => {
    expect(await LiquidRenderer.render('Hi {{ name }}!')).toBe('Hi !');
  });

  it('supports case/when branching with else', async () => {
    const tpl = "{% case service_type %}{% when 'Holiday' %}H{% when 'Cruise' %}C{% else %}X{% endcase %}";
    expect(await LiquidRenderer.render(tpl, { service_type: 'Cruise' })).toBe('C');
    expect(await LiquidRenderer.render(tpl, { service_type: 'cruise' })).toBe('X');
    expect(await LiquidRenderer.render(tpl, {})).toBe('X');
  });

  it('default filter applies to empty string and nil', async () => {
    expect(await LiquidRenderer.render("{{ a | default: 'z' }}", { a: '' })).toBe('z');
    expect(await LiquidRenderer.render("{{ a | default: 'z' }}", {})).toBe('z');
    expect(await LiquidRenderer.render("{{ a | default: 'z' }}", { a: 0 })).toBe('0');
  });

  it("treats '' as truthy in {% if %} (why dropEmptyAffinity exists)", async () => {
    expect(await LiquidRenderer.render('{% if a %}T{% else %}F{% endif %}', { a: '' })).toBe('T');
    expect(await LiquidRenderer.render('{% if a %}T{% else %}F{% endif %}', {})).toBe('F');
  });

  it('does not HTML-escape output by default', async () => {
    expect(await LiquidRenderer.render('{{ x }}', { x: '<script>' })).toBe('<script>');
    expect(await LiquidRenderer.render('{{ x | escape }}', { x: '<b>&' })).toBe('&lt;b&gt;&amp;');
  });

  it('handles unicode and a SQL-like string literally', async () => {
    expect(await LiquidRenderer.render('{{ x }}', { x: "café 🌴 '; DROP TABLE t;--" })).toBe("café 🌴 '; DROP TABLE t;--");
  });

  it('is cached: same template renders consistently with different vars', async () => {
    const t = '{{ n }}-cached';
    expect(await LiquidRenderer.render(t, { n: 1 })).toBe('1-cached');
    expect(await LiquidRenderer.render(t, { n: 2 })).toBe('2-cached');
  });

  it('rejects on syntax errors', async () => {
    await expect(LiquidRenderer.render('{% if %}')).rejects.toThrow();
    await expect(LiquidRenderer.render('{% unknowntag %}')).rejects.toThrow();
  });

  it('exposes the engine as a singleton Liquid instance', () => {
    expect(LiquidRenderer.engine).toBeInstanceOf(Liquid);
    expect(LiquidRenderer.engine).toBe(LiquidRenderer.engine);
  });
});
