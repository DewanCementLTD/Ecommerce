import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { AuthedImage } from '../../components/AuthedImage.jsx';
import { MediaPicker } from '../../components/MediaPicker.jsx';
import { SortableList, DragHandle } from '../../components/SortableList.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';

export function ProductImages({ productId, images, onChanged }) {
  const { token } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);

  async function handleSelect(media) {
    try {
      await api.addImage(token, productId, media.ID, media.ALT ?? '');
      toast.success('Image added.');
      onChanged();
    } catch (err) {
      toast.error(err.message ?? 'Failed to add image.');
    }
  }

  async function handleReorder(newOrder) {
    onChanged({ optimisticImages: newOrder });
    try {
      await api.reorderImages(
        token,
        productId,
        newOrder.map((img, index) => ({ id: img.id, position: index })),
      );
    } catch (err) {
      toast.error(err.message ?? 'Failed to reorder images — reverting.');
      onChanged();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Images</h3>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="text-sm font-medium text-blue-700 hover:underline"
        >
          + Add image
        </button>
      </div>

      {images.length === 0 ? (
        <p className="text-sm text-gray-500">No images yet.</p>
      ) : (
        <SortableList
          items={images}
          onReorder={handleReorder}
          renderItem={(img, handleProps) => (
            <div className="flex items-center gap-3 rounded border border-gray-200 bg-white p-2">
              <DragHandle {...handleProps} />
              <AuthedImage
                src={api.mediaUrl(img.mediaId, 128)}
                alt={img.alt ?? ''}
                className="h-16 w-16 rounded object-cover"
              />
              <input
                defaultValue={img.alt ?? ''}
                placeholder="Alt text"
                onBlur={async (e) => {
                  if (e.target.value === (img.alt ?? '')) return;
                  try {
                    await api.patchImage(token, productId, img.id, { alt: e.target.value });
                    onChanged();
                  } catch (err) {
                    toast.error(err.message ?? 'Failed to update alt text.');
                  }
                }}
                className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
              <ConfirmButton
                label="Remove"
                confirmTitle="Remove this image?"
                confirmMessage="This unlinks the image from the product. The file itself stays in your media library."
                onConfirm={async () => {
                  await api.deleteImage(token, productId, img.id);
                  onChanged();
                }}
                className="text-xs font-medium text-red-600 hover:underline"
              />
            </div>
          )}
        />
      )}

      <MediaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={handleSelect} />
    </div>
  );
}
