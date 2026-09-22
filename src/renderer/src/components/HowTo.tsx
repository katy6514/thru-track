interface HowToProps {
  onBack: () => void
}

function HowTo({ onBack }: HowToProps): React.JSX.Element {
  return (
    <div className="how-to">
      <button type="button" className="back-link" onClick={onBack}>
        &larr; Back to trips
      </button>

      <h1>How to use Thru Track</h1>
      <p className="how-to-dek">
        A local-first desktop app for reconstructing a day on trail by combining all types of data
        you have captured: your GPS track, your photos, your satellite check-ins, and any notes, all
        lined up against the same track. This is the whole app, front to back.
      </p>

      <div className="how-to-legend">
        <span className="how-to-legend-item">
          <span className="how-to-swatch how-to-swatch-trail" />
          Track / scrub position
        </span>
        <span className="how-to-legend-item">
          <span className="how-to-swatch how-to-swatch-note" />
          Journal note
        </span>
        <span className="how-to-legend-item">
          <span className="how-to-swatch how-to-swatch-photo" />
          Photo
        </span>
        <span className="how-to-legend-item">
          <span className="how-to-swatch how-to-swatch-message" />
          Satellite message
        </span>
      </div>

      <div className="how-to-flow">
        <span className="how-to-flow-step">Trip</span>
        <span className="how-to-flow-arrow">&rarr;</span>
        <span className="how-to-flow-step">Track (a day)</span>
        <span className="how-to-flow-arrow">&rarr;</span>
        <span className="how-to-flow-step">Map + timeline</span>
        <span className="how-to-flow-arrow">&rarr;</span>
        <span className="how-to-flow-step">Notes / photos / messages</span>
        <span className="how-to-flow-arrow">&rarr;</span>
        <span className="how-to-flow-step">Journal entry</span>
      </div>

      <nav className="how-to-toc" aria-label="Table of contents">
        <ol>
          <li>
            <a href="#trips">
              <span className="how-to-toc-num">01</span>Trips
            </a>
          </li>
          <li>
            <a href="#tracks">
              <span className="how-to-toc-num">02</span>Importing a day
            </a>
          </li>
          <li>
            <a href="#reconstruction">
              <span className="how-to-toc-num">03</span>The map &amp; timeline
            </a>
          </li>
          <li>
            <a href="#journal">
              <span className="how-to-toc-num">04</span>Writing the entry
            </a>
          </li>
          <li>
            <a href="#notes">
              <span className="how-to-toc-num">05</span>Notes
            </a>
          </li>
          <li>
            <a href="#photos">
              <span className="how-to-toc-num">06</span>Photos
            </a>
          </li>
          <li>
            <a href="#messages">
              <span className="how-to-toc-num">07</span>Satellite messages
            </a>
          </li>
          <li>
            <a href="#deleting">
              <span className="how-to-toc-num">08</span>Deleting things
            </a>
          </li>
          <li>
            <a href="#data">
              <span className="how-to-toc-num">09</span>Where your data lives
            </a>
          </li>
          <li>
            <a href="#reference">
              <span className="how-to-toc-num">10</span>Quick reference
            </a>
          </li>
        </ol>
      </nav>

      <section className="how-to-chapter" id="trips">
        <div className="how-to-chapter-head">
          <span className="how-to-chapter-num">01</span>
          <h2>Trips</h2>
        </div>
        <p className="how-to-lede">
          A trip is the whole hike — &ldquo;PCT 2026,&rdquo; a weekend loop, whatever you&rsquo;re
          calling it. Everything else lives inside one.
        </p>
        <p>
          The app opens on your list of trips. There&rsquo;s nothing to configure first — no
          account, no sign-in — just a name field and a button.
        </p>
        <ol className="how-to-steps">
          <li>
            Type a name into the field at the top (<code>PCT 2026</code>,{' '}
            <code>Wonderland Trail</code>, anything) and click <strong>Create trip</strong>.
          </li>
          <li>
            Click a trip&rsquo;s name to open it — this is where you&rsquo;ll import each day.
          </li>
          <li>
            Use <strong>Rename</strong> on a trip row to fix a typo, or <strong>Delete</strong> to
            remove it entirely.
          </li>
        </ol>
        <div className="how-to-callout">
          <span className="how-to-callout-label">Heads up</span>
          <p>
            Deleting a trip deletes every day inside it — and everything attached to those days:
            photos, notes, messages, journal entries. You&rsquo;ll be asked to confirm first, and
            there&rsquo;s no undo. More on this in <a href="#deleting">Deleting things</a>.
          </p>
        </div>
      </section>

      <section className="how-to-chapter" id="tracks">
        <div className="how-to-chapter-head">
          <span className="how-to-chapter-num">02</span>
          <h2>Importing a day</h2>
        </div>
        <p className="how-to-lede">Inside a trip, each day starts the same way: a GPX file.</p>
        <ol className="how-to-steps">
          <li>
            Open a trip, click <strong>Import GPX track</strong>, and pick a <code>.gpx</code> file
            — exported from a Garmin, Gaia GPS, CalTopo, or anywhere else that speaks GPX.
          </li>
          <li>
            The app reads it and adds the day to your list, named from the file&rsquo;s own title
            (or its date, if it has none).
          </li>
          <li>
            Click the day&rsquo;s name any time to reopen its{' '}
            <a href="#reconstruction">map and timeline</a>.
          </li>
        </ol>
        <h3>If the file has no timestamps</h3>
        <p>
          Not every day is recorded live — you might retrace a route afterward in CalTopo instead of
          carrying a GPS the whole time, precisely to save battery on a long trip. That kind of file
          has no clock in it at all, only the shape of the path.
        </p>
        <p>
          The app tries to read the date straight from the filename (
          <code>2026-07-01-caltopo.gpx</code> works; <code>Untitled.gpx</code> doesn&rsquo;t). If it
          can&rsquo;t, it&rsquo;ll ask you to pick the date before finishing the import — one extra
          click, and only when it&rsquo;s actually needed.
        </p>
        <div className="how-to-callout">
          <span className="how-to-callout-label">What you get either way</span>
          <p>
            A day like this still gets a full map. What it loses is the <em>timeline</em> —
            there&rsquo;s no clock to scrub through, so items for that day (notes, photos, messages)
            show up as a plain list instead of dots on a slider. See{' '}
            <a href="#reconstruction">&sect;03</a> and <a href="#photos">&sect;06</a>.
          </p>
        </div>
      </section>

      <section className="how-to-chapter" id="reconstruction">
        <div className="how-to-chapter-head">
          <span className="how-to-chapter-num">03</span>
          <h2>The map &amp; timeline</h2>
        </div>
        <p className="how-to-lede">
          This is the core view — where you actually relive the day before writing about it.
        </p>
        <h3>The map</h3>
        <p>
          Your route draws as a line over a topographic basemap — contour lines and shaded relief,
          so elevation is visible at a glance, not just position. If your device lost signal or was
          paused for a stretch (lunch, an overnight, a dead battery), that gap shows up as a real
          break in the line. The app won&rsquo;t draw a straight &ldquo;teleport&rdquo; across time
          it doesn&rsquo;t have data for.
        </p>
        <h3>The timeline</h3>
        <p>
          Below the map, a slider spans the whole day. Drag it, and a marker moves along the route
          to show exactly where you were at that moment.
        </p>
        <div className="how-to-callout">
          <span className="how-to-callout-label">Scrubbing into a gap</span>
          <p>
            If you drag into a stretch with no real recorded data, the marker disappears and a note
            reads <em>&ldquo;No track data here (recording gap).&rdquo;</em> That&rsquo;s deliberate
            — a guessed position would be more misleading than an honest blank.
          </p>
        </div>
        <h3>Zooming in on a cluster</h3>
        <p>
          A few photos taken two minutes apart at a viewpoint can land on top of each other on a
          full-day timeline — nothing to click individually. Use the <strong>Zoom in</strong> /{' '}
          <strong>Zoom out</strong> buttons (and <strong>&#9664;</strong> / <strong>&#9654;</strong>{' '}
          to pan) above the slider to narrow the view down to just that stretch. The same items
          spread out proportionally and become separately clickable.
        </p>
        <h3>Timeless days</h3>
        <p>
          A day imported without timestamps (&sect;02) skips the timeline section entirely —
          there&rsquo;s no clock to build one from. You still get the map, and everything attached
          to that day, just reached through a plain list rather than a slider.
        </p>
      </section>

      <section className="how-to-chapter" id="journal">
        <div className="how-to-chapter-head">
          <span className="how-to-chapter-num">04</span>
          <h2>Writing the entry</h2>
        </div>
        <p className="how-to-lede">
          The point of reconstructing the day: writing it down while it&rsquo;s all still in view.
        </p>
        <ol className="how-to-steps">
          <li>
            From a day&rsquo;s map view, click <strong>Add data</strong> and choose{' '}
            <strong>Edit journal entry</strong>.
          </li>
          <li>Type. Plain text only — no formatting to fuss with.</li>
          <li>
            That&rsquo;s it. It saves itself a moment after you stop typing; a small status line
            under the text says <span className="mono-inline">Saved</span>,{' '}
            <span className="mono-inline">Saving&hellip;</span>, or{' '}
            <span className="mono-inline">Unsaved changes&hellip;</span> so you always know where
            you stand.
          </li>
        </ol>
        <p>
          Come back to <strong>&larr; Back to map</strong> any time, and reopen the same day later —
          your entry is exactly where you left it.
        </p>
      </section>

      <section className="how-to-chapter" id="notes">
        <div className="how-to-chapter-head">
          <span className="how-to-chapter-num">05</span>
          <h2>Notes</h2>
        </div>
        <p className="how-to-lede">
          A short, timestamped thought pinned to a moment in the day — separate from the full
          journal entry.
        </p>
        <ol className="how-to-steps">
          <li>
            On a day&rsquo;s map view, find the small form under the timeline (or under the map, on
            a timeless day).
          </li>
          <li>
            On a day with a timeline, the time field defaults to wherever you&rsquo;re currently
            scrubbed to — adjust it if you mean a different moment.
          </li>
          <li>
            Type your note and click <strong>Add note</strong>.
          </li>
        </ol>
        <p>
          It appears as a small{' '}
          <span className="how-to-chip">
            <span className="how-to-swatch how-to-swatch-note" />
            orange dot
          </span>{' '}
          on the timeline (or in the plain list, on a timeless day). Click it any time to reopen it.
        </p>
        <div className="how-to-callout how-to-callout-note">
          <span className="how-to-callout-label">The side panel</span>
          <p>
            Clicking any item — a note, a photo, a message — opens a panel <em>beside</em> the map,
            not over it. The reconstruction stays visible the whole time you&rsquo;re reading or
            writing.
          </p>
        </div>
      </section>

      <section className="how-to-chapter" id="photos">
        <div className="how-to-chapter-head">
          <span className="how-to-chapter-num">06</span>
          <h2>Photos</h2>
        </div>
        <p className="how-to-lede">
          Where each photo lands depends on what it already knows about itself.
        </p>
        <ol className="how-to-steps">
          <li>
            Click <strong>Add data</strong>, choose <strong>Import photos</strong>, and select one
            or more image files.
          </li>
          <li>
            If a photo already carries GPS location (most phone cameras record this automatically),
            it&rsquo;s placed using that — directly, no guessing.
          </li>
          <li>
            If it doesn&rsquo;t, but the day has a real timeline, the app estimates its position
            from the track using the photo&rsquo;s own timestamp.
          </li>
        </ol>
        <div className="how-to-callout how-to-callout-photo">
          <span className="how-to-callout-label">Camera clock vs. GPS clock</span>
          <p>
            Cameras and GPS devices rarely agree on time exactly — a different timezone, a clock
            that was never set. After you pick photos, the app compares their timestamps against the
            track&rsquo;s and, if they don&rsquo;t line up, shows a prompt like{' '}
            <em>
              &ldquo;These photos&rsquo; timestamps look +2h from the track&rsquo;s clock — apply
              this correction?&rdquo;
            </em>{' '}
            with an editable minutes field. Confirm it (or type your own number) and the correction
            applies to the whole batch before anything is placed.
          </p>
        </div>
        <p>
          Placed photos show as a{' '}
          <span className="how-to-chip">
            <span className="how-to-swatch how-to-swatch-photo" />
            green square
          </span>{' '}
          on the timeline and a green pin on the map. Click either to see the actual image in the
          side panel.
        </p>
        <p>
          A photo with no GPS of its own <em>and</em> no timeline to estimate from (a timeless day,
          or one with no EXIF time at all) can&rsquo;t be placed on the map — but it&rsquo;s never
          silently dropped. It shows up in a plain photo list underneath, same as everything else
          that has nowhere more specific to go.
        </p>
      </section>

      <section className="how-to-chapter" id="messages">
        <div className="how-to-chapter-head">
          <span className="how-to-chapter-num">07</span>
          <h2>Satellite messages</h2>
        </div>
        <p className="how-to-lede">
          If you carry a Garmin inReach (or similar) satellite messenger, bring its check-in log
          along too.
        </p>
        <ol className="how-to-steps">
          <li>
            Click <strong>Add data</strong>, choose <strong>Import messages (CSV)</strong>, and
            select the CSV export from your device&rsquo;s tracking portal.
          </li>
          <li>
            Each message already carries its own GPS position and timestamp straight from the device
            — nothing to estimate, no clock to correct.
          </li>
        </ol>
        <p>
          Messages appear as a{' '}
          <span className="how-to-chip">
            <span className="how-to-swatch how-to-swatch-message" />
            teal diamond
          </span>{' '}
          on the timeline and a teal circle on the map. Click one to read its text, exact time, and
          coordinates.
        </p>
        <div className="how-to-callout how-to-callout-message">
          <span className="how-to-callout-label">If the file doesn&rsquo;t match</span>
          <p>
            Exports vary a little between devices and firmware versions. If the app can&rsquo;t make
            sense of the file — a missing column, a garbled row — you&rsquo;ll see a clear error
            explaining what&rsquo;s wrong, not a crash or a silently half-imported log.
          </p>
        </div>
      </section>

      <section className="how-to-chapter" id="deleting">
        <div className="how-to-chapter-head">
          <span className="how-to-chapter-num">08</span>
          <h2>Deleting things</h2>
        </div>
        <p className="how-to-lede">
          Delete means delete — everywhere, all the way down, on purpose.
        </p>
        <p>
          There&rsquo;s a <strong>Delete</strong> button on every trip and every day. Both ask you
          to confirm first, and both mean exactly what they say: removing a day takes its points,
          notes, photos (and the copies of those photo files sitting on disk), messages, and journal
          entry with it. Removing a trip does that for every day inside it.
        </p>
        <div className="how-to-callout">
          <span className="how-to-callout-label">No trash, no undo</span>
          <p>
            This is deliberate, not a missing feature. If you&rsquo;re not sure, don&rsquo;t confirm
            — there&rsquo;s nowhere to recover it from afterward.
          </p>
        </div>
      </section>

      <section className="how-to-chapter" id="data">
        <div className="how-to-chapter-head">
          <span className="how-to-chapter-num">09</span>
          <h2>Where your data lives</h2>
        </div>
        <p className="how-to-lede">On your machine. That&rsquo;s the whole answer.</p>
        <p>
          Thru Track doesn&rsquo;t need an account, a sign-in, or a network connection to work.
          Every trip, track, note, photo, message, and journal entry lives in a single local
          database, and every imported photo is copied into the app&rsquo;s own local folder
          alongside it — nothing is uploaded, and nothing needs to be. Deleting something in the app
          deletes it from disk, not just from view.
        </p>
      </section>

      <section className="how-to-chapter" id="reference">
        <div className="how-to-chapter-head">
          <span className="how-to-chapter-num">10</span>
          <h2>Quick reference</h2>
        </div>
        <p className="how-to-lede">The whole app, one row per feature.</p>
        <div className="how-to-reftable-wrap">
          <table className="how-to-reftable">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Where</th>
                <th>Marker</th>
                <th>Needs a timeline?</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Journal entry</td>
                <td>&ldquo;Add data&rdquo; &rarr; &ldquo;Edit journal entry&rdquo;</td>
                <td>&mdash;</td>
                <td>No</td>
              </tr>
              <tr>
                <td>Note</td>
                <td>Form under the timeline (or map, on a timeless day)</td>
                <td>
                  <span className="how-to-chip">
                    <span className="how-to-swatch how-to-swatch-note" />
                    Orange dot
                  </span>
                </td>
                <td>Optional</td>
              </tr>
              <tr>
                <td>Photo</td>
                <td>&ldquo;Add data&rdquo; &rarr; &ldquo;Import photos&rdquo;</td>
                <td>
                  <span className="how-to-chip">
                    <span className="how-to-swatch how-to-swatch-photo" />
                    Green square
                  </span>
                </td>
                <td>Optional</td>
              </tr>
              <tr>
                <td>Satellite message</td>
                <td>&ldquo;Add data&rdquo; &rarr; &ldquo;Import messages (CSV)&rdquo;</td>
                <td>
                  <span className="how-to-chip">
                    <span className="how-to-swatch how-to-swatch-message" />
                    Teal diamond
                  </span>
                </td>
                <td>No &mdash; always has its own GPS/time</td>
              </tr>
              <tr>
                <td>Scrub position</td>
                <td>Drag the timeline slider</td>
                <td>
                  <span className="how-to-chip">
                    <span className="how-to-swatch how-to-swatch-trail" />
                    Blue marker
                  </span>
                </td>
                <td>Yes</td>
              </tr>
              <tr>
                <td>Zoom / pan</td>
                <td>Buttons above the timeline slider</td>
                <td>&mdash;</td>
                <td>Yes</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default HowTo
