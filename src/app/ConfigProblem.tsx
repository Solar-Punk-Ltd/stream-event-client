import { configProblemText } from '@/config/runtimeConfig';
import { DEFAULT_THEME, THEME_CONTENT } from '@/design';

import './ConfigProblem.scss';

interface ConfigProblemProps {
  result: { ok: false; problem: string };
}

export function ConfigProblem({ result }: ConfigProblemProps) {
  const text = configProblemText(result);

  return (
    <main className="config-problem">
      <img
        src={THEME_CONTENT[DEFAULT_THEME].logoUrl}
        alt={THEME_CONTENT[DEFAULT_THEME].logoAlt}
        className="config-problem-logo"
      />
      <div className="config-problem-panel" role="alert">
        <h1 className="config-problem-title">{text.title}</h1>
        <p className="config-problem-detail">{text.detail}</p>
        <p className="config-problem-hint">{text.hint}</p>
      </div>
    </main>
  );
}
