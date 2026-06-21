import type { Config } from '../config.js';
import { disabledLlm, type LLMProvider } from '../skills/types.js';
import { HttpProvider } from './http-provider.js';
import { CliProvider } from './cli-provider.js';

// Story 4.4 — pick the LLM transport from config, with a NO-AI DEFAULT.
//
// Enrichment is OPTIONAL: the default install configures no provider and gets
// `disabledLlm` (the throwing sentinel from Story 3.1), so boot never requires a
// coding CLI or an API key (C10 — the coding CLI is OPT-IN, not the default; this
// deliberately reverses the prototype's claude default).
//
// Precedence (documented + tested): an explicit HTTP base-URL+model WINS over a CLI
// agent when both are set. HTTP needs base-URL AND model; CLI needs a supported
// agent (claude|codex — cursor is out of v1 scope). Anything else (incl. an unknown
// agent or a base-URL with no model) → `disabledLlm`, so a misconfiguration degrades
// to no-AI rather than blocking boot (NFR-4).
export function selectProvider(config: Config): LLMProvider {
  const p = config.provider;

  // HTTP wins when configured.
  if (p.baseUrl && p.model) {
    return new HttpProvider({ baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model });
  }

  if (p.agent === 'claude' || p.agent === 'codex') {
    return new CliProvider({ agent: { id: p.agent, model: p.model } });
  }

  return disabledLlm;
}
