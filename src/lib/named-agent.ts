export interface NamedAgentMatch {
  isNamedAgent: boolean;
  name?: string;
}

const NAMED_AGENT_TITLE = /^\s*\[AGENT\]\s+(.+?)\s*$/i;

export function recognizeNamedAgent(title: string): NamedAgentMatch {
  const match = NAMED_AGENT_TITLE.exec(title);
  if (!match) return { isNamedAgent: false };

  const name = match[1]?.trim();
  if (!name) return { isNamedAgent: false };

  return { isNamedAgent: true, name };
}
