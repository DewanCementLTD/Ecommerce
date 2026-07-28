import Link from 'next/link';
import { Media, ProductGrid, ProductCard, SectionHeading, Button } from './ui.jsx';
import { HeroSlider } from './HeroSlider.jsx';

/**
 * One component per registry type.
 *
 * Every one of them returns null when its data is empty or missing. A section
 * that was configured and then had its banner, category or collection deleted
 * leaves a quiet gap — a broken section must never break the page, which is the
 * rule the brief sets and the reason none of these throw.
 */

function Hero({ settings, data }) {
  if (!data.banners?.length) return null;
  return <HeroSlider banners={data.banners} settings={settings} />;
}

/**
 * Column counts come from settings, but they are looked up in these maps rather
 * than interpolated into CSS. Two reasons: `repeat(var(--n), 1fr)` is invalid —
 * the repeat count cannot be a variable, and the whole grid silently falls back
 * to content-sized columns that overflow a phone — and Tailwind only emits
 * classes it can see as complete strings.
 */
const MOBILE_COLS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };
const DESKTOP_COLS = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
  6: 'md:grid-cols-6',
};

function CatTiles({ settings, data, hrefBase }) {
  if (!data.cats?.length) return null;

  const mobile = MOBILE_COLS[settings.columnsMobile] ?? MOBILE_COLS[2];
  const desktop = DESKTOP_COLS[settings.columnsDesktop] ?? DESKTOP_COLS[4];

  return (
    <section className="sf-container py-12 md:py-16">
      <SectionHeading title={settings.title} />
      <ul className={`grid gap-4 ${mobile} ${desktop}`}>
        {data.cats.map((cat) => (
          <li key={cat.id}>
            <Link
              href={`${hrefBase}/cats/${cat.slug}`}
              className="group relative block overflow-hidden rounded-lg bg-surface"
            >
              <Media
                path={cat.imageUrl}
                alt=""
                ratio="aspect-square"
                sizes="(min-width: 768px) 25vw, 50vw"
                className="transition-transform duration-500 group-hover:scale-105"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-sm font-semibold text-white">
                {cat.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProdRow({ settings, data, hrefBase, currency }) {
  if (!data.products?.length) return null;

  if (settings.layout === 'carousel') {
    return (
      <section className="py-12 md:py-16">
        <div className="sf-container">
          <SectionHeading title={settings.title} />
        </div>
        {/* Native scroll-snap: swipeable on touch, no JavaScript, no library. */}
        <ul className="flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 md:px-8">
          {data.products.map((product) => (
            <li key={product.id} className="w-44 shrink-0 snap-start sm:w-56">
              <ProductCard product={product} currency={currency} hrefBase={hrefBase} />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="sf-container py-12 md:py-16">
      <SectionHeading title={settings.title} />
      <ProductGrid products={data.products} currency={currency} hrefBase={hrefBase} />
    </section>
  );
}

function Promo({ settings }) {
  if (!settings.mediaId && !settings.heading) return null;

  return (
    <section className="sf-container py-12 md:py-16">
      <div className="relative overflow-hidden rounded-lg bg-surface">
        {settings.mediaUrl ? (
          <>
            <Media
              path={settings.mediaMobileUrl ?? settings.mediaUrl}
              alt=""
              ratio="aspect-[4/5]"
              sizes="100vw"
              className="sm:hidden"
            />
            <Media
              path={settings.mediaUrl}
              alt=""
              ratio="aspect-[21/9]"
              sizes="100vw"
              className="hidden sm:block"
            />
          </>
        ) : null}

        <div
          className={`${settings.mediaUrl ? 'absolute inset-0 bg-black/35' : ''} flex flex-col items-start justify-end gap-3 p-6 md:p-12`}
        >
          {settings.heading ? (
            <h2 className={settings.mediaUrl ? 'text-white' : ''}>{settings.heading}</h2>
          ) : null}
          {settings.subheading ? (
            <p className={`max-w-prose ${settings.mediaUrl ? 'text-white/90' : 'text-muted'}`}>
              {settings.subheading}
            </p>
          ) : null}
          {settings.buttonLabel && settings.link ? (
            <Button href={settings.link} className="mt-2">
              {settings.buttonLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Best({ settings, data, hrefBase, currency }) {
  if (!data.products?.length) return null;
  return (
    <section className="sf-container py-12 md:py-16">
      <SectionHeading title={settings.title} />
      <ProductGrid products={data.products} currency={currency} hrefBase={hrefBase} />
    </section>
  );
}

function Features({ settings }) {
  const items = (settings.items ?? []).filter((item) => item.title || item.text);
  if (!items.length) return null;

  return (
    <section className="border-y border-line bg-surface py-10">
      <ul className="sf-container grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-3">
            {item.mediaUrl ? (
              <Media path={item.mediaUrl} alt="" ratio="aspect-square" className="h-10 w-10 shrink-0 rounded-sm" />
            ) : null}
            <div>
              {item.title ? <h3 className="text-base font-semibold">{item.title}</h3> : null}
              {item.text ? <p className="mt-1 text-sm text-muted">{item.text}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** No blog exists in this phase, so this always renders nothing. */
function Blog({ data }) {
  if (!data.posts?.length) return null;
  return null;
}

function News({ settings }) {
  if (!settings.heading && !settings.buttonLabel) return null;

  return (
    <section className="relative overflow-hidden py-16 md:py-24">
      {settings.backgroundMediaUrl ? (
        <>
          <Media
            path={settings.backgroundMediaUrl}
            alt=""
            ratio="aspect-auto"
            sizes="100vw"
            className="absolute inset-0 h-full w-full"
          />
          <div className="absolute inset-0 bg-black/55" />
        </>
      ) : (
        <div className="absolute inset-0 bg-surface" />
      )}

      <div className="sf-container relative text-center">
        {settings.heading ? (
          <h2 className={settings.backgroundMediaUrl ? 'text-white' : ''}>{settings.heading}</h2>
        ) : null}
        {settings.subheading ? (
          <p
            className={`mx-auto mt-3 max-w-prose ${settings.backgroundMediaUrl ? 'text-white/90' : 'text-muted'}`}
          >
            {settings.subheading}
          </p>
        ) : null}

        <form className="mx-auto mt-6 flex max-w-md flex-col gap-3 sm:flex-row" action="#" method="post">
          <label htmlFor="sf-news" className="sr-only">
            Email address
          </label>
          <input
            id="sf-news"
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-pill border border-line bg-bg px-4 py-2.5 text-sm outline-none focus:border-accent"
          />
          <Button>{settings.buttonLabel || 'Subscribe'}</Button>
        </form>
      </div>
    </section>
  );
}

function Rich({ settings }) {
  if (!settings.html) return null;
  return (
    <section className="sf-container py-12 md:py-16">
      <div
        className="mx-auto max-w-prose space-y-4 leading-relaxed"
        // Authored by the store owner in their own admin, same trust boundary as
        // any CMS body field.
        dangerouslySetInnerHTML={{ __html: settings.html }}
      />
    </section>
  );
}

const COMPONENTS = {
  hero: Hero,
  cat_tiles: CatTiles,
  prod_row: ProdRow,
  promo: Promo,
  best: Best,
  features: Features,
  blog: Blog,
  news: News,
  rich: Rich,
};

/** Renders a page's sections in order, skipping any type this build cannot draw. */
export function Sections({ sections, hrefBase, currency }) {
  return (
    <>
      {sections.map((section) => {
        const Component = COMPONENTS[section.type];
        if (!Component) return null;
        return (
          <Component
            key={section.id}
            settings={section.settings}
            data={section.data ?? {}}
            hrefBase={hrefBase}
            currency={currency}
          />
        );
      })}
    </>
  );
}
