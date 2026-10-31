import { COLOR_OPTIONS } from '../lib/colorFilter';
import './ColorFilterBar.css';

interface ColorFilterBarProps {
  selectedColor: string | null;
  onSelectColor: (color: string | null) => void;
  curved?: boolean;
  mode?: 'standard' | 'arc';
}

interface FilterItem {
  id: string | null;
  name: string;
  hex?: string;
  isAll: boolean;
}

const ALL_FILTER_ITEMS: FilterItem[] = [
  { id: null, name: 'All Wallpapers', isAll: true },
  ...COLOR_OPTIONS.map((opt) => ({ id: opt.id, name: opt.name, hex: opt.hex, isAll: false })),
];

export default function ColorFilterBar({
  selectedColor,
  onSelectColor,
  curved = false,
  mode = 'standard',
}: ColorFilterBarProps) {
  const handleColorClick = (colorId: string) => {
    if (selectedColor?.toLowerCase() === colorId.toLowerCase()) {
      onSelectColor(null);
    } else {
      onSelectColor(colorId);
    }
  };

  const isAllActive = selectedColor === null || selectedColor.toLowerCase() === 'all';
  const isArched = Boolean(curved || mode === 'arc');

  if (isArched) {
    return (
      <div className="color-filter-container is-arched">
        <nav
          className="color-filter-bar is-arched"
          role="toolbar"
          aria-label="Filter wallpapers by color"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Frosted Glass Masked Backdrop */}
          <div className="color-filter-arc-backdrop" aria-hidden="true" />

          {/* SVG Curved Pill Track */}
          <svg className="color-filter-arc-track" viewBox="0 0 460 90" aria-hidden="true">
            {/* Outer Drop Shadow */}
            <path
              d="M 35 64 Q 230 14 425 64"
              fill="none"
              stroke="rgba(0, 0, 0, 0.45)"
              strokeWidth="42"
              strokeLinecap="round"
            />
            {/* Dark Glass Fill */}
            <path
              d="M 35 64 Q 230 14 425 64"
              fill="none"
              stroke="rgba(14, 14, 18, 0.52)"
              strokeWidth="38"
              strokeLinecap="round"
            />
            {/* Subtle Glass Highlight Edge */}
            <path
              d="M 35 64 Q 230 14 425 64"
              fill="none"
              stroke="rgba(255, 255, 255, 0.12)"
              strokeWidth="38"
              strokeLinecap="round"
            />
          </svg>

          {/* Swatches positioned along the Bezier curve */}
          {ALL_FILTER_ITEMS.map((item, i) => {
            const t = i / 12; // 0.0 to 1.0
            const x = (1 - t) * (1 - t) * 35 + 2 * (1 - t) * t * 230 + t * t * 425;
            const y = (1 - t) * (1 - t) * 64 + 2 * (1 - t) * t * 14 + t * t * 64;
            const dx = 390;
            const dy = 200 * (t - 0.5);
            const rot = Math.atan2(dy, dx) * (180 / Math.PI) * 1.35;

            const isSelected = item.isAll
              ? isAllActive
              : selectedColor?.toLowerCase() === item.id;

            return (
              <button
                key={item.id ?? 'all'}
                type="button"
                className={`color-filter-btn color-swatch-btn ${item.isAll ? 'color-swatch-all-btn' : ''} ${isSelected ? 'is-active' : ''}`}
                onClick={() => {
                  if (item.isAll) {
                    onSelectColor(null);
                  } else if (item.id) {
                    handleColorClick(item.id);
                  }
                }}
                title={item.name}
                aria-label={item.isAll ? 'All wallpapers' : `Filter by ${item.name}`}
                aria-pressed={isSelected}
                style={{
                  position: 'absolute',
                  left: `${x.toFixed(1)}px`,
                  top: `${y.toFixed(1)}px`,
                  transform: `translate(-50%, -50%) rotate(${rot.toFixed(1)}deg)`,
                }}
              >
                {item.isAll ? (
                  <span
                    className="color-swatch-circle color-swatch-rainbow"
                    style={{
                      boxShadow: isSelected
                        ? '0 0 0 2px rgba(18, 18, 22, 0.9), 0 0 0 3.5px #ffffff, 0 0 12px rgba(255, 255, 255, 0.7)'
                        : undefined,
                    }}
                  />
                ) : (
                  <span
                    className="color-swatch-circle"
                    style={{
                      backgroundColor: item.hex,
                      boxShadow: isSelected
                        ? `0 0 0 2px rgba(18, 18, 22, 0.9), 0 0 0 3.5px #ffffff, 0 0 12px ${item.hex}cc`
                        : item.id === 'white'
                        ? 'inset 0 0 0 1px rgba(0, 0, 0, 0.25)'
                        : item.id === 'black'
                        ? 'inset 0 0 0 1px rgba(255, 255, 255, 0.25)'
                        : undefined,
                    }}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>
    );
  }

  // Standard Straight Pill Bar for Carousel & Shardflow
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
