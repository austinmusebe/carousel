import { COLOR_OPTIONS } from '../lib/colorFilter';
import './ColorFilterBar.css';

interface ColorFilterBarProps {
  selectedColor: string | null;
  onSelectColor: (color: string | null) => void;
}

export default function ColorFilterBar({
  selectedColor,
  onSelectColor,
}: ColorFilterBarProps) {
  const handleColorClick = (colorId: string) => {
    if (selectedColor?.toLowerCase() === colorId.toLowerCase()) {
      onSelectColor(null);
    } else {
      onSelectColor(colorId);
    }
  };

  const isAllActive = selectedColor === null || selectedColor.toLowerCase() === 'all';

  return (
    <div className="color-filter-container">
      <nav
        className="color-filter-bar"
        role="toolbar"
        aria-label="Filter wallpapers by color"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={`color-filter-btn color-filter-all-btn ${isAllActive ? 'is-active' : ''}`}
          onClick={() => onSelectColor(null)}
          title="All Wallpapers"
          aria-label="All wallpapers"
          aria-pressed={isAllActive}
        >
          <span className="color-filter-rainbow-icon" />
          <span className="color-filter-all-text">All</span>
        </button>

        <div className="color-filter-separator" aria-hidden="true" />

        <div className="color-swatches-group">
          {COLOR_OPTIONS.map((opt) => {
            const isSelected = selectedColor?.toLowerCase() === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={`color-filter-btn color-swatch-btn ${isSelected ? 'is-active' : ''}`}
                onClick={() => handleColorClick(opt.id)}
                title={opt.name}
                aria-label={`Filter by ${opt.name}`}
                aria-pressed={isSelected}
              >
                <span
                  className="color-swatch-circle"
                  style={{
                    backgroundColor: opt.hex,
                    boxShadow: isSelected
                      ? `0 0 0 2px rgba(18, 18, 22, 0.9), 0 0 0 3.5px #ffffff, 0 0 12px ${opt.hex}cc`
                      : opt.id === 'white'
                      ? 'inset 0 0 0 1px rgba(0, 0, 0, 0.25)'
                      : opt.id === 'black'
                      ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.25)'
                      : undefined,
                  }}
                />
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
