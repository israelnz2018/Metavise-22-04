// Perfil de marca — nível de CONTA (vale para todos os projetos).
// Hoje persistido em localStorage; TODO migrar para o perfil do usuário
// no Firestore (Fase 1 do plano). Mantido isolado aqui para que onboarding,
// "Meus Projetos" e a produção (Remotion) leiam a MESMA fonte.

export interface BrandProfile {
  companyName: string;
  accentColor: string;
  bgColor: string;
  logoUrl?: string;
  storeUrl?: string;
}

const BRAND_KEY = 'metavise_brand_profile';

export function loadBrand(): BrandProfile | null {
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    return raw ? (JSON.parse(raw) as BrandProfile) : null;
  } catch {
    return null;
  }
}

export function saveBrand(brand: BrandProfile): void {
  localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
}

export function hasBrand(): boolean {
  return loadBrand() !== null;
}
