import './RandomiseButton.css';

interface RandomiseButtonProps {
  onRandomise: () => void;
  variant?: 'standard' | 'vinyl' | 'style';
}

export default function RandomiseButton({
  onRandomise,
  variant = 'standard',
}: RandomiseButtonProps) {
  const variantClass =
    variant === 'vinyl' ? 'is-vinyl' : variant === 'style' ? 'is-style' : '';

  return (
    <div className={`randomise-btn-container ${variantClass}`}>
      <button
        type="button"
        className="randomise-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRandomise();
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        title="Select a random wallpaper"
        aria-label="Randomise wallpaper selection"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="16 3 21 3 21 8" />
          <line x1="4" y1="20" x2="21" y2="3" />
          <polyline points="21 16 21 21 16 21" />
          <line x1="15" y1="15" x2="21" y2="21" />
          <line x1="4" y1="4" x2="9" y2="9" />
        </svg>
        <span>Randomise</span>
      </button>
    </div>
  );
}
