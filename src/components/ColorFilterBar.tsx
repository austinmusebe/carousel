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
  { id: null, name: 'All', isAll: true },
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
          {ALL_FILTER_ITEMS.map((item, i) => {
            const d = i - 6;
            const x = d * 28;
            const y = d * d * 1.6;
            const rot = d * 3.2;
            const isSelected = item.isAll
              ? isAllActive
              : selectedColor?.toLowerCase() === item.id;

            return (
              <button
                key={item.id ?? 'all'}
                type="button"
                className={`color-filter-btn color-swatch-btn ${item.isAll ? 'color-swatch-all-curved' : ''} ${isSelected ? 'is-active' : ''}`}
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
                  transform: `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg)`,
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
