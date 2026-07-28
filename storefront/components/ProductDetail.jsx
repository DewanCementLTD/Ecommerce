'use client';

import { useMemo, useState } from 'react';
import { mediaUrl, mediaSrcSet } from '../lib/media.js';
import { Price } from './ui.jsx';
import { useCart } from '../lib/CartContext.jsx';
import { useToast } from '../lib/ToastContext.jsx';

/**
 * The product page. Client-side because the gallery and the variant picker are
 * interactive; the data arrives fully resolved from the server render.
 *
 * A product with one variant hides the picker entirely — a "simple" product is
 * just a product with a single default variant, which keeps one code path
 * instead of two.
 */
export function ProductDetail({ product, currency, storeName }) {
  const images = product.images?.length ? product.images : [];
  const [activeImage, setActiveImage] = useState(0);
  const [selection, setSelection] = useState(() => ({ ...(product.defaultVariant?.opts ?? {}) }));
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const { addItem } = useCart();
  const toast = useToast();

  const hasOptions = product.options?.length > 0 && product.variants.length > 1;

  const selectedVariant = useMemo(() => {
    if (!hasOptions) return product.defaultVariant ?? product.variants[0] ?? null;
    return (
      product.variants.find((variant) =>
        Object.entries(selection).every(([key, value]) => variant.opts?.[key] === value),
      ) ?? null
    );
  }, [hasOptions, product.variants, product.defaultVariant, selection]);

  async function handleAddToCart() {
    if (!selectedVariant?.inStock || adding) return;
    setAdding(true);
    try {
      await addItem(selectedVariant.id, quantity);
      toast(`Added ${quantity} × ${product.name} to your basket.`);
    } catch (err) {
      toast(err.message, { tone: 'error' });
    } finally {
      setAdding(false);
    }
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.shortDesc || undefined,
    brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
    image: images.map((image) => image.url),
    offers: selectedVariant
      ? {
          '@type': 'Offer',
          price: selectedVariant.salePrice ?? selectedVariant.price,
          priceCurrency: currency || undefined,
          availability: selectedVariant.inStock
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          seller: { '@type': 'Organization', name: storeName },
        }
      : undefined,
  };

  return (
    <div className="sf-container py-8 pb-24 md:py-12 lg:pb-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-14">
        <div>
          <div className="overflow-hidden rounded-lg bg-surface">
            {images.length ? (
              <img
                src={mediaUrl(images[activeImage].url, 1024)}
                srcSet={mediaSrcSet(images[activeImage].url)}
                sizes="(min-width: 1024px) 50vw, 100vw"
                alt={images[activeImage].alt || product.name}
                className="aspect-square w-full object-cover"
                fetchPriority="high"
              />
            ) : (
              <div className="aspect-square w-full bg-surface" aria-hidden="true" />
            )}
          </div>

          {images.length > 1 ? (
            <ul className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {images.map((image, index) => (
                <li key={image.mediaId}>
                  <button
                    type="button"
                    onClick={() => setActiveImage(index)}
                    aria-label={`View image ${index + 1}`}
                    aria-current={index === activeImage ? 'true' : undefined}
                    className={`overflow-hidden rounded-md border-2 transition-colors ${
                      index === activeImage ? 'border-accent' : 'border-transparent hover:border-line'
                    }`}
                  >
                    <img
                      src={mediaUrl(image.url, 320)}
                      alt=""
                      className="h-20 w-20 object-cover"
                      loading="lazy"
                    />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="lg:pt-4">
          {product.brand ? (
            <p className="text-sm font-medium uppercase tracking-wide text-muted">{product.brand}</p>
          ) : null}
          <h1 className="mt-1">{product.name}</h1>

          {selectedVariant ? (
            <Price
              price={selectedVariant.price}
              salePrice={selectedVariant.salePrice}
              currency={currency}
              className="mt-4 text-2xl"
            />
          ) : null}

          {product.shortDesc ? <p className="mt-4 max-w-prose text-muted">{product.shortDesc}</p> : null}

          {hasOptions ? (
            <div className="mt-8 space-y-5">
              {product.options.map((option) => (
                <fieldset key={option.name}>
                  <legend className="text-sm font-semibold">{option.name}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {option.vals.map((value) => {
                      const active = selection[option.name] === value;
                      const available = product.variants.some(
                        (variant) => variant.opts?.[option.name] === value && variant.inStock,
                      );
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setSelection((current) => ({ ...current, [option.name]: value }))}
                          aria-pressed={active}
                          className={`rounded-pill border px-4 py-2 text-sm transition-colors ${
                            active ? 'border-accent bg-accent text-white' : 'border-line hover:border-accent'
                          } ${available ? '' : 'opacity-50'}`}
                        >
                          {value}
                          {!available ? <span className="sr-only"> (out of stock)</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          ) : null}

          <p className="mt-6 text-sm font-medium" aria-live="polite">
            {!selectedVariant ? (
              <span className="text-muted">Choose an option to see availability</span>
            ) : selectedVariant.inStock ? (
              <span className="text-accent">In stock</span>
            ) : (
              <span className="text-muted">Out of stock</span>
            )}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-pill border border-line">
              <button
                type="button"
                onClick={() => setQuantity((n) => Math.max(1, n - 1))}
                aria-label="Decrease quantity"
                className="px-4 py-2 text-lg leading-none hover:text-accent"
              >
                −
              </button>
              <span className="min-w-8 text-center text-sm font-semibold" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((n) => Math.min(99, n + 1))}
                aria-label="Increase quantity"
                className="px-4 py-2 text-lg leading-none hover:text-accent"
              >
                +
              </button>
            </div>

            <button
              type="button"
              disabled={!selectedVariant?.inStock || adding}
              onClick={handleAddToCart}
              className="inline-flex flex-1 items-center justify-center rounded-pill bg-primary px-6 py-3 text-sm font-semibold text-primary-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {adding ? 'Adding…' : 'Add to basket'}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">Cash on delivery — no online payment needed.</p>

          {product.descr ? (
            <div className="mt-10 border-t border-line pt-8">
              <h2 className="text-lg">Description</h2>
              <div
                className="mt-3 max-w-prose space-y-3 leading-relaxed text-muted"
                dangerouslySetInnerHTML={{ __html: product.descr }}
              />
            </div>
          ) : null}

          {product.tags?.length ? (
            <ul className="mt-8 flex flex-wrap gap-2">
              {product.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-pill bg-surface px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted"
                >
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {/* Sticky mobile add-to-cart — most traffic is mobile, and the main
          button above scrolls out of view on a long description. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 p-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          {selectedVariant ? (
            <Price price={selectedVariant.price} salePrice={selectedVariant.salePrice} currency={currency} className="flex-shrink-0" />
          ) : null}
          <button
            type="button"
            disabled={!selectedVariant?.inStock || adding}
            onClick={handleAddToCart}
            className="inline-flex flex-1 items-center justify-center rounded-pill bg-primary px-6 py-3 text-sm font-semibold text-primary-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {adding ? 'Adding…' : !selectedVariant?.inStock ? 'Out of stock' : 'Add to basket'}
          </button>
        </div>
      </div>
    </div>
  );
}
