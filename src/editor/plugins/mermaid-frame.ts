import type { MermaidConfig } from 'mermaid';

export interface FrameLink {
  href: string;
  title: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export type FrameDrawing =
  | {
      ok: true;
      svg: string;
      width: number;
      height: number;
      links: FrameLink[];
    }
  | { ok: false; message: string };

export interface MermaidFrame {
  draw(
    id: string,
    source: string,
    config: MermaidConfig
  ): Promise<FrameDrawing>;
}

declare global {
  interface Window {
    nyamarkMermaid?: MermaidFrame;
  }
}

type Mermaid = typeof import('mermaid').default;

let mermaidPromise: Promise<Mermaid> | null = null;
let configured = '';

function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then(
    ({ default: mermaid }) => mermaid,
    (error) => {
      mermaidPromise = null;
      throw error;
    }
  );
  return mermaidPromise;
}

function pixels(value: string | null | undefined): number {
  const match = /^\s*([\d.]+)(px)?\s*$/.exec(value ?? '');
  const number = Number(match?.[1]);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

const round = (value: number) => Math.round(value * 100) / 100;

const XLINK = 'http://www.w3.org/1999/xlink';

function linksOf(svg: SVGSVGElement): FrameLink[] {
  const anchors = [...svg.querySelectorAll('a')];
  if (!anchors.length) return [];
  document.body.append(svg);
  try {
    const picture = svg.getBoundingClientRect();
    if (!picture.width || !picture.height) return [];
    const percent = (value: number, of: number) => round((100 * value) / of);
    return anchors.flatMap((anchor) => {
      const href =
        anchor.getAttribute('href') ?? anchor.getAttributeNS(XLINK, 'href');
      const box = anchor.getBoundingClientRect();
      if (!href || !box.width || !box.height) return [];
      return [
        {
          href,
          title: anchor.getAttribute('title') ?? '',
          left: percent(box.left - picture.left, picture.width),
          top: percent(box.top - picture.top, picture.height),
          width: percent(box.width, picture.width),
          height: percent(box.height, picture.height),
        },
      ];
    });
  } finally {
    svg.remove();
  }
}

function asPicture(markup: string) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  const svg = template.content.querySelector('svg');
  if (!svg) throw new Error('Mermaid drew nothing.');
  const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const boxWidth = box.length === 4 ? pixels(String(box[2])) : 0;
  const boxHeight = box.length === 4 ? pixels(String(box[3])) : 0;
  const maxWidth = /max-width:\s*([\d.]+)px/.exec(
    svg.getAttribute('style') ?? ''
  )?.[1];
  let width = pixels(maxWidth) || pixels(svg.getAttribute('width')) || boxWidth;
  let height =
    boxWidth && boxHeight && width
      ? (width * boxHeight) / boxWidth
      : pixels(svg.getAttribute('height'));
  width = round(width);
  height = round(height);
  if (width && height) {
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.style.removeProperty('max-width');
  }
  const links = linksOf(svg);
  if (width && height) {
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
  }
  return {
    svg: new XMLSerializer().serializeToString(svg),
    width,
    height,
    links,
  };
}

async function draw(
  id: string,
  source: string,
  config: MermaidConfig
): Promise<FrameDrawing> {
  try {
    const mermaid = await loadMermaid();
    const settings = JSON.stringify(config);
    if (settings !== configured) {
      mermaid.initialize(config);
      configured = settings;
    }
    const { svg } = await mermaid.render(id, source);
    return { ok: true, ...asPicture(svg) };
  } catch (error) {
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
}

window.nyamarkMermaid = { draw };
