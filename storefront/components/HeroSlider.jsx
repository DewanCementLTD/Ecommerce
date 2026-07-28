'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { mediaUrl, mediaSrcSet } from '../lib/media.js';

const HEIGHTS = {
  short: 'aspect-[16/9] sm:aspect-[21/8]',
  medium: 'aspect-[4/5] sm:aspect-[21/9]',
  tall: 'aspect-[3/4] sm:aspect-[2/1]',
};

/**
 * The only interactive component on the storefront, so it is the only client
 * one. A single slide renders as a plain image with no controls and no timer.
 *
 * Autoplay stops on hover, on focus, when the tab is hidden, and for anyone who
 * has asked for reduced motion — a carousel that keeps moving while someone is
 * reading it is an accessibility problem, not a feature.
 */
export function HeroSlider({ banners, settings }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const regionRef = useRef(null);

  const count = banners.length;
  const height = HEIGHTS[settings.height] ?? HEIGHTS.medium;
  const interval = Math.min(Math.max(settings.interval ?? 6, 2), 30) * 1000;

  useEffect(() => {
    if (count < 2 || !settings.autoplay || paused) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const timer = setInterval(() => setIndex((current) => (current + 1) % count), interval);
    return () => clearInterval(timer);
  }, [count, settings.autoplay, paused, interval]);

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const go = (next) => setIndex(((next % count) + count) % count);

  return (
    <section
      ref={regionRef}
      aria-roledescription="carousel"
      aria-label="Featured"
      className="relative overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className={`relative w-full ${height}`}>
        {banners.map((banner, position) => {
          const active = position === index;
          const image = (
            <picture>
              <source media="(max-width: 639px)" srcSet={mediaSrcSet(banner.mobileUrl)} sizes="100vw" />
              <img
                src={mediaUrl(banner.url, 1600)}
                srcSet={mediaSrcSet(banner.url)}
                sizes="100vw"
                alt={banner.alt ?? ''}
                loading={position === 0 ? 'eager' : 'lazy'}
                fetchPriority={position === 0 ? 'high' : 'auto'}
                decoding="async"
                className="h-full w-full object-cover"
              />
            </picture>
          );

          return (
            <div
              key={banner.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${position + 1} of ${count}`}
              aria-hidden={!active}
              className={`absolute inset-0 transition-opacity duration-700 ${
                active ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              {banner.link ? (
                <Link href={banner.link} tabIndex={active ? 0 : -1} className="block h-full w-full">
                  {image}
                </Link>
              ) : (
                image
              )}
            </div>
          );
        })}
      </div>

      {count > 1 ? (
        <>
          <div className="absolute inset-x-0 bottom-4 flex justify-center gap-2">
            {banners.map((banner, position) => (
              <button
                key={banner.id}
                type="button"
                onClick={() => go(position)}
                aria-label={`Go to slide ${position + 1}`}
                aria-current={position === index ? 'true' : undefined}
                className={`h-2 rounded-pill transition-all duration-300 ${
                  position === index ? 'w-8 bg-white' : 'w-2 bg-white/60 hover:bg-white/90'
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="Previous slide"
            className="absolute start-3 top-1/2 hidden -translate-y-1/2 rounded-pill bg-white/85 p-2 text-black hover:bg-white sm:block"
          >
            <Chevron dir="start" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next slide"
            className="absolute end-3 top-1/2 hidden -translate-y-1/2 rounded-pill bg-white/85 p-2 text-black hover:bg-white sm:block"
          >
            <Chevron dir="end" />
          </button>
        </>
      ) : null}
    </section>
  );
}

function Chevron({ dir }) {
  return (
    <svg
      className={`h-5 w-5 ${dir === 'start' ? 'rtl:rotate-180' : 'rotate-180 rtl:rotate-0'}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
