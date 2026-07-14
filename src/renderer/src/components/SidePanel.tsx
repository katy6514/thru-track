// A generic, persistent side panel that renders alongside the main reconstruction view (map,
// timeline, journal editor) rather than covering it, per the parent PRD's "side panel over
// modal" decision. It knows nothing about "notes" specifically — it just takes a title and
// arbitrary content — so later slices (photos, satellite messages) can reuse it unmodified by
// passing their own title/children when their own timeline item is selected.
interface SidePanelProps {
  title: string
  onClose: () => void
  children: React.ReactNode
}

function SidePanel({ title, onClose, children }: SidePanelProps): React.JSX.Element {
  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h2>{title}</h2>
        <button
          type="button"
          className="side-panel-close"
          onClick={onClose}
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>
      <div className="side-panel-content">{children}</div>
    </aside>
  )
}

export default SidePanel
