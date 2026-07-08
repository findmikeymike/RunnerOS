import { describe, it, expect } from 'bun:test';
import matter from 'gray-matter';
import { STARTER_SKILLS } from '../starter-templates.ts';
import { BUNDLED_STARTER_SKILLS } from '../bundled.generated.ts';

describe('STARTER_SKILLS', () => {
  it('has unique kebab-case slugs', () => {
    const slugs = STARTER_SKILLS.map(s => s.slug);
    const seen = new Set<string>();
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(seen.has(slug)).toBe(false);
      seen.add(slug);
    }
  });

  function getSkillMd(skill: { files: { path: string; content: string }[] }): string {
    const f = skill.files.find(f => f.path === 'SKILL.md');
    if (!f) throw new Error('Missing SKILL.md');
    return f.content;
  }

  it('every entry parses to valid SKILL.md frontmatter (name + description)', () => {
    for (const skill of STARTER_SKILLS) {
      const parsed = matter(getSkillMd(skill));
      expect(typeof parsed.data.name).toBe('string');
      expect((parsed.data.name as string).trim().length).toBeGreaterThan(0);
      expect(typeof parsed.data.description).toBe('string');
      expect((parsed.data.description as string).trim().length).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty markdown body', () => {
    for (const skill of STARTER_SKILLS) {
      const parsed = matter(getSkillMd(skill));
      expect(parsed.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('includes the source-recipe starter skill', () => {
    const recipe = STARTER_SKILLS.find(s => s.slug === 'source-recipe');
    expect(recipe).toBeDefined();
    const parsed = matter(getSkillMd(recipe!));
    expect(parsed.data.name).toBe('Source Recipe');
    // Description must mention list_sources so the trigger matcher can fire.
    expect((parsed.data.description as string).toLowerCase()).toContain('source');
    // Body must reference the live catalog tool.
    expect(parsed.content).toContain('list_sources');
    // Cap rule must be present so curation behavior is preserved.
    expect(parsed.content.toLowerCase()).toContain('3 sources');
  });

  it('keeps the agent-creator, automation-creator, and workflow-creator starters', () => {
    const slugs = STARTER_SKILLS.map(s => s.slug);
    expect(slugs).toContain('agent-creator');
    expect(slugs).toContain('automation-creator');
    expect(slugs).toContain('workflow-creator');
  });

  it('includes the hidden RunnerOS self-edit starter skill', () => {
    const skill = STARTER_SKILLS.find(s => s.slug === 'runneros-self-edit');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('RunnerOS Self Edit');
    expect(parsed.content).toContain('developer.selfEdit.repoPath');
    expect(parsed.content).toContain('apps/electron');
  });

  it('includes the Artist OS guide starter skill for HNIC support', () => {
    const skill = STARTER_SKILLS.find(s => s.slug === 'artist-os-guide');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('Artist OS Guide');
    expect(parsed.content).toContain('What Artist OS is');
    expect(parsed.content).toContain('Settings → Messaging');
  });

  it('workflow-creator can save confirmed workflow drafts', () => {
    const skill = STARTER_SKILLS.find(s => s.slug === 'workflow-creator');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.tools).toContain('create_workflow');
    expect(parsed.content).toContain('Use `create_workflow` to save');
    expect(parsed.content).toContain('## Step sizing principle');
    expect(parsed.content).toContain('Prefer **fewer, richer steps**');
    expect(parsed.content).toContain('## Chaining pattern');
    expect(parsed.content).toContain('## Reliability defaults');
    expect(parsed.content).toContain('`image`, `video`, `audio`');
    expect(parsed.content).not.toContain('`media`');
  });

  it('includes raw-video-editor for existing footage edits', () => {
    const skill = STARTER_SKILLS.find(s => s.slug === 'raw-video-editor');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('raw-video-editor');
    expect(parsed.content).toContain('Edit existing footage');
    expect(parsed.content).toContain('ffprobe');
    expect(parsed.content).toContain('takes_packed.md');
    expect(parsed.content).toContain('edl.json');
    expect(parsed.content).toContain('MIT licensed');
  });
});

describe('BUNDLED_STARTER_SKILLS', () => {
  function getSkillMd(skill: { files: { path: string; content: string }[] }): string {
    const f = skill.files.find(f => f.path === 'SKILL.md');
    if (!f) throw new Error('Missing SKILL.md');
    return f.content;
  }

  it('every bundled skill parses to valid SKILL.md frontmatter', () => {
    for (const skill of BUNDLED_STARTER_SKILLS) {
      const parsed = matter(getSkillMd(skill));
      expect(parsed.data.name, skill.slug).toBeTruthy();
      expect(parsed.data.description, skill.slug).toBeTruthy();
      expect(parsed.content.trim().length, skill.slug).toBeGreaterThan(0);
    }
  });

  it('includes the Branding Agent skill bundle', () => {
    const requiredSlugs = [
      'artist-brand-dna-audit',
      'artist-narrative-universe',
      'artist-belief-system',
      'artist-campaign-angle-builder',
      'artist-visual-world-director',
      'artist-brand-expression-strategist',
    ];

    for (const slug of requiredSlugs) {
      const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === slug);
      expect(skill).toBeDefined();
      const parsed = matter(getSkillMd(skill!));
      expect(typeof parsed.data.description).toBe('string');
      expect(parsed.content.trim().length).toBeGreaterThan(0);
    }
  });

  it('includes scroll-stopper with its engine reference', () => {
    const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'scroll-stopper');

    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('scroll-stopper');
    expect(parsed.data.category).toBe('content-generation');
    expect(parsed.content).toContain('Use `references/engine.json` as the source of truth');
    const engine = skill!.files.find(f => f.path === 'references/engine.json');
    expect(engine?.content).toContain('Scroll Stoppers');
    expect(engine?.content).toContain('cover_doctrine');
    expect(engine?.content).toContain('realism_doctrine');
  });

  it('includes artist-industry-hunter for the Industry Hunter worker', () => {
    const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'artist-industry-hunter');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('Artist Industry Hunter');
    expect(parsed.content).toContain('artist-profile');
    expect(parsed.content).toContain('artist-voice');
    expect(parsed.content).toContain('artist-branding');
    expect(parsed.content).toContain('start_deep_research');
    expect(parsed.content).toContain('planPolicy: "auto"');
    expect(parsed.content).toContain('planPolicy: "approve"');
    expect(parsed.content).toContain('get_deep_research_run');
    expect(parsed.content).toContain('Industry Hunter Target List');
    expect(parsed.content).toContain('Outreach Agent handoff');
  });

  it('includes spotify-canvas-video for silent Spotify Canvas loops', () => {
    const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'spotify-canvas-video');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('spotify-canvas-video');
    expect(parsed.content).toContain('Vertical 9:16');
    expect(parsed.content).toContain('Do not add voiceover');
    expect(parsed.content).toContain('Do not require OpenAI');
  });

  it('includes record-doctor-handoff for producer review submissions', () => {
    const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'record-doctor-handoff');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('Record Doctor Handoff');
    expect(parsed.content).toContain('mikeymikemusic@gmail.com');
    expect(parsed.content).toContain('Artist HQ context');
    expect(parsed.content).toContain('Gmail is optional');
    expect(parsed.content).toContain('explicit current-turn approval');
    expect(parsed.content).toContain('POST /users/me/drafts');
    expect(parsed.content).toContain('POST /users/me/drafts/send');
    expect(parsed.content).not.toContain('Runner');
  });

  it('includes magnetic-outreach for cold first-contact draft craft', () => {
    const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'magnetic-outreach');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('magnetic-outreach');
    expect(parsed.content).toContain('cold message');
    expect(parsed.content).toContain('Engine A');
    expect(parsed.content).toContain('Engine B');
    expect(parsed.content).toContain('status-aware');
    expect(parsed.content).toContain('earned, not performed');
    expect(parsed.content).toContain('Never fake specificity');
    expect(parsed.content).toContain('not for warm relationships');
  });

  it('includes world-immersion for immersive release campaign worlds', () => {
    const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'world-immersion');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('world-immersion');
    expect(parsed.content).toContain('The artist builds; the fan enters');
    expect(parsed.content).toContain('one central, psychologically-grounded immersive mechanic');
    expect(parsed.content).toContain('The four anti-corny laws');
    expect(parsed.content).toContain('needy-prompt check');
    expect(parsed.content).toContain('reskin test');
    expect(parsed.content).toContain('failure modes');
  });

  it('includes captions-and-overlays for Content Genius finishing copy', () => {
    const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'captions-and-overlays');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('captions-and-overlays');
    expect(typeof parsed.data.description).toBe('string');
    expect(parsed.content).toContain('This is a finishing skill for Content Genius');
    expect(parsed.content).toContain('on-screen overlay');
    expect(parsed.content).toContain('first caption line');
    expect(parsed.content).toContain('promise a payoff the video can deliver');
  });

  it('includes artist-art-direction for taste-led artwork concepts', () => {
    const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'artist-art-direction');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('Artist Art Direction');
    expect(parsed.content).toContain('70s Vinyl Cover');
    expect(parsed.content).toContain('Tasteful Collage');
    expect(parsed.content).toContain('FADER Mag');
    expect(parsed.content).toContain('Far Out');
    expect(parsed.content).toContain('Album / Single Art Mode');
    expect(parsed.content).toContain('Merch Design Mode');
    expect(parsed.content).toContain('Typography / Layout Execution');
    expect(parsed.content).toContain('artwork_compose');
    expect(parsed.content).toContain('export PNG preview');
    expect(parsed.content).toContain('showInCanvas: true');
    expect(parsed.content).toContain('Artwork Builder Handoff');
    expect(parsed.content).toContain('Never fake a real artist likeness');
    expect(parsed.content).toContain('Do not generate immediately');
    expect(parsed.content).not.toContain('Runner');
  });

  it('includes artist-typography-taste for cover, merch, and poster type direction', () => {
    const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'artist-typography-taste');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('Artist Typography Taste');
    expect(parsed.content).toContain('70s Vinyl');
    expect(parsed.content).toContain('Editorial / FADER');
    expect(parsed.content).toContain('Psychedelic / Far Out');
    expect(parsed.content).toContain('Luxury / Minimal');
    expect(parsed.content).toContain('Zine / Punk / Grunge');
    expect(parsed.content).toContain('Street Poster / Mixtape');
    expect(parsed.content).toContain('Open-Source Font Kit');
    expect(parsed.content).toContain('Fraunces');
    expect(parsed.content).toContain('Archivo Black');
    expect(parsed.content).toContain('Bebas Neue');
    expect(parsed.content).toContain('Exact font asset available');
    expect(parsed.content).toContain('artwork_compose');
    expect(parsed.content).toContain('showInCanvas: true');
    expect(parsed.content).toContain('Georgia, Times New Roman, serif');
    expect(parsed.content).not.toContain('Runner');
  });

  it('bundles paid ads browser operator with danger-control stop rules', () => {
    const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'paid-ads-browser-operator');
    expect(skill).toBeDefined();
    const parsed = matter(getSkillMd(skill!));
    expect(parsed.data.name).toBe('paid-ads-browser-operator');
    expect(parsed.content).toContain('browser dashboard/export mode');
    expect(parsed.content).toContain('Spotify Ads Manager');
    expect(parsed.content).toContain('Spotify for Artists');
    expect(parsed.content).toContain('do not call `ads-operator --platform spotify`');
    expect(parsed.content).toContain('Stop before clicking any ambiguous Save, Publish, Apply, Launch');
    expect(parsed.content).toContain('Do not use receipts to claim live ad execution');
  });

  it('bundles separated paid ads planning and creative skills', () => {
    for (const slug of ['artist-ad-dna', 'ad-library-intel', 'ads-strategy', 'ads-creative-development']) {
      const skill = BUNDLED_STARTER_SKILLS.find(s => s.slug === slug);
      expect(skill).toBeDefined();
      const parsed = matter(getSkillMd(skill!));
      expect(parsed.data.name).toBe(slug);
      expect(parsed.content).toContain(slug === 'ad-library-intel' ? 'Ad Library Intel Packet' : 'Ads Agent');
    }
  });

  it('bundles music-specific Meta conversion and visual hook doctrine', () => {
    const conversion = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'music-ad-conversion-protocol');
    const visual = BUNDLED_STARTER_SKILLS.find(s => s.slug === 'music-ad-visual-hooks');

    expect(conversion).toBeDefined();
    expect(visual).toBeDefined();

    const conversionParsed = matter(getSkillMd(conversion!));
    expect(conversionParsed.content).toContain('Optimize for the service-button click event');
    expect(conversionParsed.content).toContain('Instagram Feed');
    expect(conversionParsed.content).toContain('Spotify Reality Check');
    expect(conversionParsed.content).toContain('Never recommend any live account mutation');

    const visualParsed = matter(getSkillMd(visual!));
    expect(visualParsed.content).toContain('Sonic World Method');
    expect(visualParsed.content).toContain('Meme / UGC');
    expect(visualParsed.content).toContain('delayed Spotify/cover reveal');
    expect(visualParsed.content).toContain('Do not operate ad accounts');
  });
});
