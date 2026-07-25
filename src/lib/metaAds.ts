// ESTRUTURA do Meta Ads — DESLIGADA DE PROPÓSITO. Não conecta nada ainda.
// Há relatos de contas do Meta caindo quando linkadas ao Claude, então deixamos
// toda a estrutura pronta (tipos, tela, mapeamento criativo→métrica) mas SEM
// chamar o conector. Quando for seguro, é só implementar fetchMetaMetrics().

export interface CreativeMetrics {
  creativeId: string; // url ou id do criativo
  name: string;
  campaign?: string;
  spend: number; // US$ gastos
  impressions: number;
  clicks: number;
  ctr: number; // %
  cpa: number; // US$ por resultado
  roas: number; // retorno sobre gasto
  purchases: number;
}

export interface MetaConnection {
  connected: boolean;
  accountId?: string;
  reason?: string;
}

// Trava dura: enquanto false, nada é conectado nem consultado.
export const META_CONNECTED = false;

// Status atual da conexão. Sempre desconectado por ora (decisão de segurança).
export function getMetaConnection(): MetaConnection {
  return {
    connected: META_CONNECTED,
    reason: 'Conexão desativada de propósito — relatos de contas do Meta caindo ao linkar com o Claude.',
  };
}

// Puxaria as métricas por criativo do Meta Ads. PROPOSITALMENTE não chama o
// conector ainda — retorna vazio até liberarmos. A assinatura já é a final.
export async function fetchMetaMetrics(_creativeIds: string[]): Promise<CreativeMetrics[]> {
  if (!META_CONNECTED) return [];
  // TODO(quando seguro): chamar o conector Meta Ads e mapear pra CreativeMetrics.
  return [];
}
