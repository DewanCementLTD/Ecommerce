import { SECTIONS } from '@storeforge/shared';
import { api } from '../../lib/api.js';
import { AuthedImage } from '../AuthedImage.jsx';

/**
 * An approximate, structured preview — not a pixel-accurate replica of the
 * storefront (that renderer is Next-coupled; see docs/PHASE-1-REPORT.md-adjacent
 * plan notes). Good enough to see what's configured and in what order.
 */
export function SectionPreview({ sections, refs }) {
  const visible = sections.filter((s) => s.isActive);
  if (visible.length === 0) {
    return <p className="text-sm text-gray-400">No active sections — the page would render empty.</p>;
  }
  return (
    <div className="space-y-3">
      {visible.map((s) => (
        <SectionPreviewCard key={s.id} section={s} refs={refs} />
      ))}
    </div>
  );
}

function SectionPreviewCard({ section, refs }) {
  const def = SECTIONS[section.type];
  const settings = section.settings ?? {};

  return (
    <div className="rounded border border-dashed border-gray-300 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{def?.label ?? section.type}</p>
      <div className="mt-2">{renderBody(section.type, settings, refs)}</div>
    </div>
  );
}

function nameOf(list, id) {
  return list?.find((x) => x.id === id)?.name;
}

function renderBody(type, settings, refs) {
  switch (type) {
    case 'hero':
      return (
        <div className="flex h-20 items-center justify-center rounded bg-gray-100 text-sm text-gray-500">
          {settings.bannerIds?.length ?? 0} banner(s) · {settings.autoplay ? 'autoplay' : 'manual'} · {settings.height}
        </div>
      );
    case 'cat_tiles':
      return (
        <div>
          {settings.title && <p className="font-medium">{settings.title}</p>}
          <div className="mt-1 flex flex-wrap gap-1">
            {(settings.catIds ?? []).map((id) => (
              <span key={id} className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                {nameOf(refs?.cats, id) ?? `#${id}`}
              </span>
            ))}
            {(settings.catIds ?? []).length === 0 && <span className="text-xs text-gray-400">No categories chosen</span>}
          </div>
        </div>
      );
    case 'prod_row':
      return (
        <div>
          {settings.title && <p className="font-medium">{settings.title}</p>}
          <p className="text-xs text-gray-500">
            {settings.source === 'collection' && `Collection: ${nameOf(refs?.colls, settings.collId) ?? '—'}`}
            {settings.source === 'category' && `Category: ${nameOf(refs?.cats, settings.catId) ?? '—'}`}
            {settings.source === 'manual' && `${settings.productIds?.length ?? 0} chosen product(s)`}
            {settings.source === 'newest' && 'Newest products'}
            {settings.source === 'featured' && 'Featured products'}
            {' · '}
            {settings.limit} shown · {settings.layout}
          </p>
        </div>
      );
    case 'promo':
      return (
        <div className="flex items-center gap-3">
          {settings.mediaId ? (
            <AuthedImage src={api.mediaUrl(settings.mediaId, 96)} alt="" className="h-14 w-20 rounded object-cover" />
          ) : (
            <span className="flex h-14 w-20 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">No image</span>
          )}
          <div>
            <p className="font-medium">{settings.heading || '(no heading)'}</p>
            <p className="text-xs text-gray-500">{settings.subheading}</p>
          </div>
        </div>
      );
    case 'best':
      return <p className="text-xs text-gray-500">{settings.title} · {settings.limit} shown · {settings.period}</p>;
    case 'features':
      return (
        <div className="flex flex-wrap gap-3">
          {(settings.items ?? []).map((item, i) => (
            <div key={i} className="w-24 text-center text-xs">
              {item.mediaId ? (
                <AuthedImage src={api.mediaUrl(item.mediaId, 64)} alt="" className="mx-auto h-10 w-10 rounded object-cover" />
              ) : (
                <span className="mx-auto block h-10 w-10 rounded bg-gray-100" />
              )}
              <p className="mt-1 font-medium">{item.title || '—'}</p>
            </div>
          ))}
          {(settings.items ?? []).length === 0 && <span className="text-xs text-gray-400">No features yet</span>}
        </div>
      );
    case 'blog':
      return <p className="text-xs text-gray-400">Hidden until a blog exists.</p>;
    case 'news':
      return <p className="font-medium">{settings.heading || '(no heading)'}</p>;
    case 'rich':
      return <p className="text-xs text-gray-500">{(settings.html ?? '').replace(/<[^>]+>/g, '').slice(0, 120) || '(empty)'}</p>;
    default:
      return null;
  }
}
