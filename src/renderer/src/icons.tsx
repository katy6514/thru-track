// Small line icons for the track detail page's add-data actions — plain inline SVG rather than
// an icon library dependency, since this is the only place icons are used in the app so far.
// Each is a fixed 24x24 viewBox, stroked in currentColor so it matches whatever text color the
// button around it uses.

function iconProps(): React.SVGProps<SVGSVGElement> {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  }
}

export function JournalIcon(): React.JSX.Element {
  return (
    <svg {...iconProps()}>
      <path d="M4 5.5C4 4.67 4.67 4 5.5 4H11a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5H4V5.5Z" />
      <path d="M20 5.5c0-.83-.67-1.5-1.5-1.5H13a2 2 0 0 0-2 2v14a1.5 1.5 0 0 1 1.5-1.5H20V5.5Z" />
    </svg>
  )
}

export function PhotoIcon(): React.JSX.Element {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.75" />
      <path d="m4 17 5-5 3.5 3.5L17 10l4 4" />
    </svg>
  )
}

export function MessageIcon(): React.JSX.Element {
  return (
    <svg {...iconProps()}>
      <path d="M20 5.5A2.5 2.5 0 0 0 17.5 3h-11A2.5 2.5 0 0 0 4 5.5v8A2.5 2.5 0 0 0 6.5 16H8v4l5-4h4a2.5 2.5 0 0 0 2.5-2.5v-8Z" />
    </svg>
  )
}

export function PhoneIcon(): React.JSX.Element {
  return (
    <svg {...iconProps()}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <line x1="10.5" y1="18.2" x2="13.5" y2="18.2" />
    </svg>
  )
}
