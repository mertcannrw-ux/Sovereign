import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_BRIEF_LIMIT,
  matchesTemplate,
  sortTemplates,
  templateGuides,
  templates,
} from './templates';

describe('template catalog', () => {
  it('gives every template a brief the create API can store', () => {
    expect(Object.keys(templateGuides).sort()).toEqual(
      templates.map((template) => template.id).sort(),
    );
    for (const template of templates) {
      const guide = templateGuides[template.id];
      if (!guide) throw new Error(`missing guide for ${template.id}`);
      expect(guide.brief.length).toBeGreaterThan(40);
      expect(guide.brief.length).toBeLessThanOrEqual(TEMPLATE_BRIEF_LIMIT);
      expect(guide.screens.length).toBeGreaterThan(0);
      expect(guide.includes.length).toBeGreaterThan(0);
      expect(guide.bestFor.length).toBeGreaterThan(0);
    }
  });

  it('matches a feature that is not in the template name', () => {
    const hits = templates.filter((template) => matchesTemplate(template, 'invoice subscription'));
    expect(hits.map((template) => template.id)).toEqual(['tpl-billing-portal']);
  });

  it('requires every search word, not a single hit', () => {
    expect(templates.filter((template) => matchesTemplate(template, 'invoice kanban'))).toEqual([]);
  });

  it('sorts featured templates ahead of higher-use unfeatured ones', () => {
    const sorted = sortTemplates(templates, 'recommended');
    const firstPlain = sorted.findIndex((template) => !template.featured);
    const lastFeatured = sorted.findLastIndex((template) => template.featured);
    expect(lastFeatured).toBeGreaterThanOrEqual(0);
    expect(lastFeatured).toBeLessThan(firstPlain);
    expect(sortTemplates(templates, 'name').map((template) => template.name)).toEqual(
      [...templates].map((template) => template.name).sort((a, b) => a.localeCompare(b)),
    );
  });
});
