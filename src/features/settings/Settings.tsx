import { useState } from 'react';
import { Modal } from '../../shared/Modal';
import { categories, settingsCatalog } from './catalog';
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
  const [category, setCategory] = useState<string>('All'),
    [query, setQuery] = useState('');
  const search = query.toLowerCase().trim();
  const visible = settingsCatalog.filter(
    (setting) =>
      (category === 'All' || category === setting.category) &&
      search
        .split(/\s+/)
        .every((term) =>
          `${setting.label} ${setting.description} ${setting.category} ${setting.options?.map((option) => option.label).join(' ') ?? ''}`
            .toLowerCase()
            .includes(term),
        ),
  );
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="settings-panel">
        <input
          data-autofocus
          aria-label="Search settings"
          placeholder="Search settings…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCategory('All');
          }}
        />
        <nav aria-label="Settings categories">
          {['All', ...categories].map((item) => (
            <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {categories.map((group) => {
            const items = visible.filter((setting) => setting.category === group);
            return !items.length ? null : (
              <fieldset key={group}>
                <legend>{group}</legend>
                {items.map((setting) => (
                  <div className="settings-row" key={setting.key}>
                    <label htmlFor={`setting-${setting.key}`}>{setting.label}</label>
                    {setting.options ? (
                      <select
                        id={`setting-${setting.key}`}
                        aria-label={setting.label}
                        value={String(value[setting.key])}
                        onChange={(event) => {
                          const option = setting.options!.find(
                            (option) => String(option.value) === event.target.value,
                          )!;
                          onChange(normalizeSettings({ ...value, [setting.key]: option.value }));
                        }}
                      >
                        {setting.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`setting-${setting.key}`}
                        aria-label={setting.label}
                        type="checkbox"
                        checked={!!value[setting.key]}
                        onChange={(event) =>
                          onChange(
                            normalizeSettings({ ...value, [setting.key]: event.target.checked }),
                          )
                        }
                      />
                    )}
                    <p>{setting.description}</p>
                  </div>
                ))}
              </fieldset>
            );
          })}
          {!visible.length && <p>No settings match “{query}”.</p>}
        </div>
        <footer>
          <span>Changes are saved automatically.</span>
          <button onClick={() => onChange({ ...defaultSettings })}>Reset defaults</button>
        </footer>
      </div>
    </Modal>
  );
}
