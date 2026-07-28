import { ProductGridSkeleton } from '../components/ui.jsx';

/** Skeletons, not spinners: the shape of what is about to arrive. */
export default function Loading() {
  return (
    <div className="sf-container py-12">
      <div className="sf-skeleton mb-10 h-64 w-full rounded-lg sm:h-80" />
      <ProductGridSkeleton />
    </div>
  );
}
