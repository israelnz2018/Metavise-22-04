// Biblioteca de SKILLS de melhoria de copy (Estágio 2 — "melhorar de verdade").
// O usuário adiciona/baixa skills (nome + texto da skill) e aplica uma por cima
// da copy já gerada. Guardado em localStorage (não Firestore) pra funcionar sem
// depender do deploy das regras — igual aos favoritos de voz/avatar.
// Sem skills embutidas: a lista é 100% do usuário.

export interface CopySkill {
  id: string;
  name: string;
  content: string;
  createdAt: number;
}

const KEY = 'metavise_copy_skills';

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    // fallback abaixo
  }
  return `skill_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

export function loadCopySkills(): CopySkill[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (s) =>
        s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.content === 'string'
    );
  } catch {
    return [];
  }
}

function persist(skills: CopySkill[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(skills));
  } catch {
    // localStorage cheio ou indisponível — ignora (não quebra a UI)
  }
}

/** Adiciona uma skill. Retorna a lista atualizada. */
export function addCopySkill(name: string, content: string): CopySkill[] {
  const clean = { name: name.trim(), content: content.trim() };
  if (!clean.name || !clean.content) return loadCopySkills();
  const skills = loadCopySkills();
  skills.push({ id: genId(), name: clean.name, content: clean.content, createdAt: Date.now() });
  persist(skills);
  return skills;
}

/** Remove uma skill pelo id. Retorna a lista atualizada. */
export function deleteCopySkill(id: string): CopySkill[] {
  const skills = loadCopySkills().filter((s) => s.id !== id);
  persist(skills);
  return skills;
}
