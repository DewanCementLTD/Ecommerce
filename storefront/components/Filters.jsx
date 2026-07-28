import Link from 'next/link';

/**
 * Filters and sorting as plain links and a GET form — no JavaScript required,
 * every state is a real URL that can be shared, bookmarked and crawled.
 */
const SORTS = [
  { key: 'created:desc', label: 'Newest' },
  { key: 'price:asc', label: 'Price, low to high' },
  { key: 'price:desc', label: 'Price, high to low' },
  { key: 'name:asc', label: 'A to Z' },
];

export function Filters({ basePath, query, total }) {
  const current = `${query.sort ?? 'created'}:${query.dir ?? 'desc'}`;

  const hrefWith = (patch) => {
    const params = new URLSearchParams();
    const merged = { ...query, ...patch };
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined && value !== null && value !== '' && key !== 'page') {
        params.set(key, String(value));
      }
    }
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  };

  const hasFilters = Boolean(query.inStock || query.min || query.max);

  return (
    <div className="mb-8 flex flex-col gap-4 border-y border-line py-4 lg:flex-row lg:items-center lg:justify-between">
      <p className="text-sm text-muted">
        {total} {total === 1 ? 'product' : 'products'}
      </p>

      <div className="flex flex-wrap items-center gap-4">
        <form method="get" action={basePath} className="flex flex-wrap items-center gap-2">
          {query.sort ? <input type="hidden" name="sort" value={query.sort} /> : null}
          {query.dir ? <input type="hidden" name="dir" value={query.dir} /> : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="inStock"
              value="1"
              defaultChecked={query.inStock === '1'}
              className="h-4 w-4 accent-[var(--c-accent)]"
            />
            In stock only
          </label>

          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-muted">Min</span>
            <input
              type="number"
              name="min"
              min="0"
              step="0.01"
              defaultValue={query.min ?? ''}
              className="w-20 rounded-sm border border-line bg-bg px-2 py-1 text-sm"
            />
          </label>

          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-muted">Max</span>
            <input
              type="number"
              name="max"
              min="0"
              step="0.01"
              defaultValue={query.max ?? ''}
              className="w-20 rounded-sm border border-line bg-bg px-2 py-1 text-sm"
            />
          </label>

          <button
            type="submit"
            className="rounded-pill border border-line px-4 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
          >
            Apply
          </button>

          {hasFilters ? (
            <Link href={hrefWith({ inStock: '', min: '', max: '' })} className="text-sm text-muted underline">
              Clear
            </Link>
          ) : null}
        </form>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Sort</span>
          <ul className="flex flex-wrap gap-1">
            {SORTS.map((sort) => {
              const [sortKey, dir] = sort.key.split(':');
              return (
                <li key={sort.key}>
                  <Link
                    href={hrefWith({ sort: sortKey, dir })}
                    aria-current={current === sort.key ? 'true' : undefined}
                    className={`rounded-pill px-3 py-1 ${
                      current === sort.key ? 'bg-primary text-primary-ink' : 'text-muted hover:text-accent'
                    }`}
                  >
                    {sort.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
