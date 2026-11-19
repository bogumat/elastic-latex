import { Modal } from '../../shared/Modal';
import { defaultSettings, normalizeSettings, type EditorSettings } from './preferences';

export default function Settings({
  value,
  onChange,
  onClose,
}: {
  value: EditorSettings;
  onChange: (value: EditorSettings) => void;
  onClose: () => void;
}) {
  const update = (next: Partial<EditorSettings>) =>
    onChange(normalizeSettings({ ...value, ...next }));
  return (
    <Modal title="Settings" onClose={onClose}>
      <label>
        Theme
        <select
          aria-label="Theme"
          value={value.theme}
          onChange={(event) => update({ theme: event.target.value as EditorSettings['theme'] })}
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </label>
      <label>
        Font size
        <select
          aria-label="Font size"
          value={value.fontSize}
          onChange={(event) => update({ fontSize: Number(event.target.value) })}
        >
          {Array.from({ length: 19 }, (_, index) => index + 10).map((size) => (
            <option key={size} value={size}>
              {size} px
            </option>
          ))}
        </select>
      </label>
      <label>
        Tab width
        <select
          aria-label="Tab width"
          value={value.tabSize}
          onChange={(event) => update({ tabSize: Number(event.target.value) })}
        >
          {[2, 4, 8].map((size) => (
            <option key={size} value={size}>
              {size} spaces
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.wrap}
          onChange={(event) => update({ wrap: event.target.checked })}
        />{' '}
        Wrap lines
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.autosave}
          onChange={(event) => update({ autosave: event.target.checked })}
        />{' '}
        Autosave
      </label>
      <p>⌘S always saves all edited files and compiles, including when autosave is off.</p>
      <button onClick={() => onChange({ ...defaultSettings })}>Reset defaults</button>
    </Modal>
  );
}
