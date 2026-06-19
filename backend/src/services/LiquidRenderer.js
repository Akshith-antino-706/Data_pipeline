import { Liquid } from 'liquidjs';

/**
 * LiquidRenderer — wraps liquidjs for win-back email templates (J01–J22).
 *
 * The 63 win-back templates use Liquid for service-aware branching:
 *   {% case service_type %}
 *     {% when 'Holiday' %} ... {% when 'Cruise' %} ... {% else %} ...
 *   {% endcase %}
 *
 * Day 1–7 templates DO NOT use this — they go through the existing regex
 * replacement path in EmailRenderer. The engine column on email_html_templates
 * selects which path runs.
 */

const engine = new Liquid({
  cache: true,
  greedy: false,
});

export default class LiquidRenderer {
  /** Render a Liquid template string with the given variable map. */
  static async render(template, vars = {}) {
    if (!template) return '';
    return engine.parseAndRender(template, vars);
  }

  /** Expose the underlying engine for advanced cases (e.g. adding filters). */
  static get engine() {
    return engine;
  }
}
