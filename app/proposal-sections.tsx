"use client";

/**
 * What goes in the proposal, chosen before it is built.
 *
 * Ticked parts are produced and shown; unticked ones are not produced at all,
 * which is the point of asking first rather than trimming after. A part this
 * prospect has nothing to fill stays on the list, greyed, with the reason
 * beside it — dropping it from the list would read as a part the tool cannot
 * produce, which is a different claim.
 */

export type SectionOption = {
  id: string; label: string; detail: string;
  available: boolean; note: string; reason: string;
};

export default function ProposalSectionPicker({ options, chosen, disabled = false, onChange }: {
  options: SectionOption[];
  chosen: string[];
  disabled?: boolean;
  onChange: (ids: string[]) => void;
}) {
  if (!options.length) return null;
  const offered = options.filter((option) => option.available);
  const all = offered.length > 0 && offered.every((option) => chosen.includes(option.id));

  function toggle(id: string) {
    onChange(chosen.includes(id) ? chosen.filter((entry) => entry !== id) : [...chosen, id]);
  }

  return (
    <div className="proposal-parts">
      <div className="proposal-parts-head">
        <div>
          <p className="eyebrow">What goes in the proposal</p>
          <small>Ticked parts are built and included. Unticked ones are not built at all.</small>
        </div>
        <button
          type="button"
          disabled={disabled || !offered.length}
          onClick={() => onChange(all ? [] : offered.map((option) => option.id))}
        >
          {all ? "Clear" : "Select all"}
        </button>
      </div>
      <ul>
        {options.map((option) => (
          <li key={option.id} className={option.available ? "" : "unavailable"}>
            <label>
              <input
                type="checkbox"
                checked={option.available && chosen.includes(option.id)}
                disabled={disabled || !option.available}
                onChange={() => toggle(option.id)}
              />
              <div>
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
                <em>{option.available ? option.note : option.reason}</em>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
