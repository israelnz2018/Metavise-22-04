// Subprojetos (variants) moram em uma SUBCOLEÇÃO `projects/{id}/variants/{vid}`,
// não mais num array dentro do doc do projeto. O array num doc único estourava
// o limite rígido de 1 MiB do Firestore conforme os subprojetos cresciam — cada
// subprojeto agora tem seu próprio documento, com seu próprio teto de 1 MiB.
//
// O resto do app continua lendo `project.variants` (array em memória): o loader
// popula esse array a partir da subcoleção, então as telas (ProjectsTab, mapa
// brief→variant, etc.) não precisam mudar.
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { ProjectVariant } from '@/types/project';

const variantsCol = (projectId: string) => collection(db, 'projects', projectId, 'variants');

/** Lê todos os subprojetos de um projeto. O id do doc é a fonte de verdade. */
export async function loadVariants(projectId: string): Promise<ProjectVariant[]> {
  const snap = await getDocs(variantsCol(projectId));
  return snap.docs.map((d) => ({ ...(d.data() as any), id: d.id }) as ProjectVariant);
}

/** Grava (cria ou substitui) UM subprojeto. O variant.id vira o id do doc. */
export async function saveVariant(projectId: string, variant: ProjectVariant): Promise<void> {
  await setDoc(doc(db, 'projects', projectId, 'variants', variant.id), variant);
}

/** Remove UM subprojeto da subcoleção. */
export async function deleteVariantDoc(projectId: string, variantId: string): Promise<void> {
  await deleteDoc(doc(db, 'projects', projectId, 'variants', variantId));
}
