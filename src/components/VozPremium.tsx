import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "react-hot-toast";
import {
  Mic,
  Upload,
  Music,
  Loader2,
  CheckCircle2,
  Play,
  X,
  Sparkles,
  Filter,
  Search,
  Wand2,
  FileText,
  Film,
  Trash2,
} from "lucide-react";
import {
  VozPremiumMode,
  ElevenLabsVoice,
  CatalogFilters,
  listVoices,
  generateAudio,
  cloneVoice,
  cleanAudio,
  uploadReadyAudio,
} from "../lib/vozPremiumService";
import { optimizeCopyForElevenLabsWithClaude } from "../lib/claudeService";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage, auth } from "../lib/firebase";

interface Props {
  approvedScript?: string;
  projectId?: string;
  personaGender?: string;
  personaAge?: string;
  savedAudioUrl?: string;
  savedAudios?: {
    url: string;
    storagePath: string | null;
    voiceId: string;
    createdAt: string;
  }[];
  copyAnswers?: Record<string, any>;
  savedOptimizedScript?: string;
  onOptimizedScript?: (optimized: string) => void;
  onApprovedScriptEdit?: (edited: string) => void;
  onAudioReady?: (
    audioUrl: string,
    voiceId?: string,
    storagePath?: string | null,
  ) => void;
  onDeleteAudioFromHistory?: (url: string, storagePath: string | null) => void;
  onGoToVideo?: () => void;
}

const MODES: {
  id: VozPremiumMode;
  label: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "catalog",
    label: "Catálogo",
    desc: "Escolha uma voz da biblioteca",
    icon: <Music size={20} />,
  },
  {
    id: "clone",
    label: "Clonar voz",
    desc: "Suba um áudio e clone sua voz",
    icon: <Mic size={20} />,
  },
  {
    id: "ready",
    label: "Áudio pronto",
    desc: "Já tenho o áudio gravado",
    icon: <Upload size={20} />,
  },
];

const GENDERS = [
  { v: "", l: "Todos" },
  { v: "female", l: "Feminino" },
  { v: "male", l: "Masculino" },
];
const AGES = [
  { v: "", l: "Todos" },
  { v: "young", l: "Jovem" },
  { v: "middle_aged", l: "Adulto" },
  { v: "old", l: "Sênior" },
];
const LANGUAGES = [
  { v: "", l: "Todos" },
  { v: "pt", l: "Português" },
  { v: "en", l: "Inglês" },
  { v: "es", l: "Espanhol" },
];
const USE_CASES = [
  { v: "", l: "Todos" },
  { v: "advertisement", l: "Publicidade" },
  { v: "social_media", l: "Social Media" },
  { v: "narration", l: "Narração" },
  { v: "conversational", l: "Conversacional" },
];

const VozPremium: React.FC<Props> = ({
  approvedScript = "",
  projectId,
  personaGender,
  personaAge,
  savedAudioUrl,
  savedAudios = [],
  copyAnswers = {},
  savedOptimizedScript = "",
  onOptimizedScript,
  onApprovedScriptEdit,
  onAudioReady,
  onDeleteAudioFromHistory,
  onGoToVideo,
}) => {
  const [mode, setMode] = useState<VozPremiumMode>("catalog");
  const [showRemoveActiveModal, setShowRemoveActiveModal] = useState(false);
  const [editedApproved, setEditedApproved] = useState<string>(approvedScript);
  const [savedApproved, setSavedApproved] = useState<string>(approvedScript);
  const [optimizedScript, setOptimizedScript] =
    useState<string>(savedOptimizedScript);
  const [savedOptimized, setSavedOptimized] =
    useState<string>(savedOptimizedScript);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [script, setScript] = useState(savedOptimizedScript || approvedScript);

  const isApprovedDirty = editedApproved.trim() !== savedApproved.trim();
  const isOptimizedDirty = optimizedScript.trim() !== savedOptimized.trim();

  // Catalog state
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<ElevenLabsVoice | null>(
    null,
  );
  const detectLanguage = (text: string): string => {
    if (!text) return "";
    const ptWords = [
      "você",
      "não",
      "para",
      "com",
      "uma",
      "que",
      "seu",
      "sua",
      "por",
      "mas",
      "como",
      "isso",
      "este",
      "está",
      "são",
    ];
    const enWords = [
      "you",
      "the",
      "and",
      "for",
      "with",
      "that",
      "your",
      "this",
      "are",
      "have",
      "from",
      "they",
      "will",
      "can",
    ];
    const esWords = [
      "usted",
      "para",
      "con",
      "que",
      "por",
      "pero",
      "como",
      "esto",
      "está",
      "son",
      "una",
      "los",
      "las",
    ];
    const lower = text.toLowerCase();
    const ptScore = ptWords.filter((w) => lower.includes(w)).length;
    const enScore = enWords.filter((w) => lower.includes(w)).length;
    const esScore = esWords.filter((w) => lower.includes(w)).length;
    if (ptScore === 0 && enScore === 0 && esScore === 0) return "";
    if (ptScore >= enScore && ptScore >= esScore) return "pt";
    if (enScore >= ptScore && enScore >= esScore) return "en";
    return "es";
  };

  const detectedLanguage = useMemo(
    () => detectLanguage(approvedScript),
    [approvedScript],
  );

  const mapGender = (g?: string): "male" | "female" | "" => {
    if (!g) return "";
    const lower = g.toLowerCase();
    if (
      lower.includes("mulher") ||
      lower.includes("female") ||
      lower.includes("fem")
    )
      return "female";
    if (
      lower.includes("homem") ||
      lower.includes("male") ||
      lower.includes("masc")
    )
      return "male";
    return "";
  };

  const mapAge = (a?: string): "young" | "middle_aged" | "old" | "" => {
    if (!a) return "";
    const lower = a.toLowerCase();
    if (
      lower.includes("young") ||
      lower.includes("jovem") ||
      lower.includes("18") ||
      lower.includes("25")
    )
      return "young";
    if (
      lower.includes("middle") ||
      lower.includes("adulto") ||
      lower.includes("35") ||
      lower.includes("45")
    )
      return "middle_aged";
    if (
      lower.includes("old") ||
      lower.includes("senior") ||
      lower.includes("sênior") ||
      lower.includes("55")
    )
      return "old";
    return "";
  };

  const [filters, setFilters] = useState<CatalogFilters>({
    language: detectLanguage(approvedScript),
    gender: mapGender(personaGender),
    age: mapAge(personaAge),
  });
  const [searchText, setSearchText] = useState("");
  const [langWarning, setLangWarning] = useState(false);
  const [pendingLanguage, setPendingLanguage] = useState("");
  const [generating, setGenerating] = useState(false);

  // Clone state
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [removeNoise, setRemoveNoise] = useState(true);
  const [cloning, setCloning] = useState(false);
  const [clonedVoiceId, setClonedVoiceId] = useState("");
  const [cloneMode, setCloneMode] = useState<"record" | "upload">("record");
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Ready audio state
  const [readyFile, setReadyFile] = useState<File | null>(null);
  const [cleanNoise, setCleanNoise] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Result state
  const [localAudioUrl, setLocalAudioUrl] = useState(savedAudioUrl || "");
  const [done, setDone] = useState(!!savedAudioUrl);

  // Load voices when catalog tab is active
  useEffect(() => {
    if (savedAudioUrl) {
      setLocalAudioUrl(savedAudioUrl);
      setDone(true);
    }
  }, [savedAudioUrl]);

  useEffect(() => {
    if (mode !== "catalog") return;
    setLoadingVoices(true);
    listVoices({ ...filters, search: searchText })
      .then(setVoices)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoadingVoices(false));
  }, [mode, filters, searchText]);

  // Sync from props
  useEffect(() => {
    setEditedApproved(approvedScript);
    setSavedApproved(approvedScript);
  }, [approvedScript]);
  useEffect(() => {
    if (savedOptimizedScript) {
      setOptimizedScript(savedOptimizedScript);
      setSavedOptimized(savedOptimizedScript);
      setScript(savedOptimizedScript);
    } else if (approvedScript) {
      setScript(approvedScript);
    }
  }, [savedOptimizedScript, approvedScript]);

  // Save handlers
  const handleSaveApproved = () => {
    setSavedApproved(editedApproved);
    onApprovedScriptEdit?.(editedApproved);
    toast.success("Copy aprovada salva!");
  };
  const handleSaveOptimized = () => {
    setSavedOptimized(optimizedScript);
    setScript(optimizedScript);
    onOptimizedScript?.(optimizedScript);
    toast.success("Copy otimizada salva!");
  };

  // Optimize handler
  const handleOptimize = async () => {
    if (!savedApproved) {
      toast.error(
        "Nenhum roteiro aprovado encontrado. Volte à etapa de Copywriting.",
      );
      return;
    }
    if (isApprovedDirty) {
      toast.error("Salve a copy aprovada antes de otimizar.");
      return;
    }
    setIsOptimizing(true);
    try {
      const optimized = await optimizeCopyForElevenLabsWithClaude(
        savedApproved,
        copyAnswers || {},
      );
      setOptimizedScript(optimized);
      setSavedOptimized(optimized);
      setScript(optimized);
      onOptimizedScript?.(optimized);
      toast.success("Copy otimizada para ElevenLabs!");
    } catch (e: any) {
      toast.error(e?.message || "Erro ao otimizar a copy.");
    } finally {
      setIsOptimizing(false);
    }
  };

  const filterBtn = (
    val: string,
    cur: string,
    setter: (v: string) => void,
    label: string,
    isLanguage = false,
  ) => (
    <button
      key={val}
      onClick={() => {
        if (
          isLanguage &&
          val !== "" &&
          val !== detectedLanguage &&
          detectedLanguage !== ""
        ) {
          setPendingLanguage(val);
          setLangWarning(true);
          return;
        }
        setter(val);
      }}
      className={`text-xs px-3 py-1.5 rounded-lg border transition ${cur === val ? "border-purple-500 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}
    >
      {label}
    </button>
  );

  const uploadToFirebase = async (
    audioBlob: Blob,
    voiceId: string,
  ): Promise<{ url: string; storagePath: string | null }> => {
    try {
      if (auth.currentUser) {
        const storageRef = ref(
          storage,
          `audio/${auth.currentUser.uid}/${Date.now()}.mp3`,
        );
        await uploadBytes(storageRef, audioBlob, { contentType: "audio/mpeg" });
        const downloadUrl = await getDownloadURL(storageRef);
        return { url: downloadUrl, storagePath: storageRef.fullPath };
      }
    } catch (err: any) {
      console.error("[VozPremium] Firebase upload falhou:", err.message);
    }
    return { url: "", storagePath: null };
  };

  const handleGenerateCatalog = async () => {
    if (!selectedVoice) {
      toast.error("Selecione uma voz.");
      return;
    }
    if (!script) {
      toast.error("Roteiro não encontrado. Volte à etapa de copy.");
      return;
    }
    setGenerating(true);
    try {
      const result = await generateAudio({
        voiceId: selectedVoice.voice_id,
        script,
      });
      // Faz upload no Firebase Storage igual à aba Voz atual
      const audioResponse = await fetch(result.audioUrl);
      const audioBlob = await audioResponse.blob();
      const { url, storagePath } = await uploadToFirebase(
        audioBlob,
        selectedVoice.voice_id,
      );
      const finalUrl = url || result.audioUrl;
      setLocalAudioUrl(finalUrl);
      setDone(true);
      toast.success("Áudio gerado!");
      onAudioReady?.(finalUrl, selectedVoice.voice_id, storagePath);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCloneAndGenerate = async () => {
    const audioSource = recordedBlob
      ? new File([recordedBlob], `gravacao-${Date.now()}.webm`, {
          type: "audio/webm",
        })
      : cloneFile;
    if (!audioSource) {
      toast.error("Grave ou envie um áudio.");
      return;
    }
    const finalName =
      cloneName || `Minha voz — ${new Date().toLocaleDateString("pt-BR")}`;
    if (!script) {
      toast.error("Roteiro não encontrado. Volte à etapa de copy.");
      return;
    }
    setCloning(true);
    try {
      toast("Clonando sua voz...");
      const { voiceId } = await cloneVoice({
        audioFile: audioSource,
        name: finalName,
        removeNoise: true,
      });
      setClonedVoiceId(voiceId);
      const clonedVoices = [
        ...(savedAudios?.filter((a: any) => a.voiceId && a.clonedName) || []),
      ];
      toast.success("Voz clonada! Gerando áudio com seu roteiro...");
      const result = await generateAudio({ voiceId, script });
      const audioResponse = await fetch(result.audioUrl);
      const audioBlob = await audioResponse.blob();
      const { url, storagePath } = await uploadToFirebase(audioBlob, voiceId);
      const finalUrl = url || result.audioUrl;
      setLocalAudioUrl(finalUrl);
      setDone(true);
      toast.success("Pronto! Áudio gerado com sua voz clonada.");
      onAudioReady?.(finalUrl, voiceId, storagePath);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCloning(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      setRecordingSeconds(0);
      setIsRecording(true);
      setRecordedBlob(null);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setRecordedBlob(blob);
        setIsRecording(false);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start(100);

      let seconds = 0;
      timerRef.current = setInterval(() => {
        seconds++;
        setRecordingSeconds(seconds);
        if (seconds >= 120) {
          clearInterval(timerRef.current!);
          mediaRecorder.stop();
          toast("Gravação encerrada automaticamente aos 2 minutos.");
        }
      }, 1000);
    } catch (err) {
      toast.error(
        "Não foi possível acessar o microfone. Verifique as permissões do navegador.",
      );
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleReadyAudio = async () => {
    if (!readyFile) {
      toast.error("Envie o áudio pronto.");
      return;
    }
    try {
      let fileToUpload = readyFile;
      if (cleanNoise) {
        setCleaning(true);
        toast("Limpando ruído do áudio...");
        const cleaned = await cleanAudio({ audioFile: readyFile });
        const response = await fetch(cleaned.audioUrl);
        const blob = await response.blob();
        fileToUpload = new File([blob], readyFile.name, { type: "audio/mp3" });
        setCleaning(false);
        toast.success("Áudio limpo!");
      }
      setUploading(true);
      const result = await uploadReadyAudio(fileToUpload);
      const audioResponse = await fetch(result.audioUrl);
      const audioBlob = await audioResponse.blob();
      const { url, storagePath } = await uploadToFirebase(audioBlob, "");
      const finalUrl = url || result.audioUrl;
      setLocalAudioUrl(finalUrl);
      setDone(true);
      toast.success("Áudio pronto para usar!");
      onAudioReady?.(finalUrl, undefined, storagePath);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCleaning(false);
      setUploading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={20} className="text-purple-500" />
          <span className="text-xs uppercase tracking-wider text-purple-600 font-semibold">
            Premium
          </span>
        </div>
        <h2 className="text-3xl font-light text-gray-900">Voz Premium</h2>
        <p className="text-gray-500 mt-2">
          Otimize o roteiro e gere o áudio do seu anúncio.
        </p>
      </div>

      {/* ── STEP 1: APPROVED COPY (editable + save + optimize) ── */}
      <div className="mb-6 bg-white rounded-2xl border-2 border-gray-100 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="bg-blue-600 p-1.5 rounded-lg text-white">
            <FileText size={16} />
          </div>
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">
            1. Copy Aprovada
          </h3>
          <span className="text-xs text-gray-400 ml-auto">
            vinda do Copywriting / Hook
          </span>
          {isApprovedDirty && (
            <span className="text-xs text-orange-500 font-bold">
              • Não salvo
            </span>
          )}
        </div>
        {approvedScript ? (
          <textarea
            value={editedApproved}
            onChange={(e) => setEditedApproved(e.target.value)}
            rows={8}
            className="w-full bg-gray-50 text-gray-800 text-base rounded-xl p-5 border-2 border-dashed border-gray-200 focus:border-blue-400 outline-none leading-relaxed resize-y"
          />
        ) : (
          <div className="bg-gray-50 rounded-xl p-5 border-2 border-dashed border-gray-200">
            <p className="text-sm text-gray-400 italic">
              Nenhuma copy aprovada. Volte à etapa de Copywriting e aprove um
              hook + script.
            </p>
          </div>
        )}
        {approvedScript && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-gray-400">
              {editedApproved.trim().split(/\s+/).filter(Boolean).length}{" "}
              palavras
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveApproved}
                disabled={!isApprovedDirty}
                className="px-6 py-3 bg-green-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-green-100 flex items-center gap-2"
              >
                <CheckCircle2 size={16} />
                Salvar
              </button>
              {!optimizedScript && (
                <button
                  onClick={handleOptimize}
                  disabled={isOptimizing || isApprovedDirty || !savedApproved}
                  title={
                    isApprovedDirty ? "Salve a copy antes de otimizar" : ""
                  }
                  className="px-8 py-3 bg-amber-500 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed transition-all shadow-lg shadow-amber-100 flex items-center gap-2"
                >
                  {isOptimizing ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <Wand2 size={16} />
                  )}
                  {isOptimizing ? "Otimizando..." : "Otimizar para ElevenLabs"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── STEP 2: OPTIMIZED COPY (editable + save) ── */}
      {optimizedScript && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-gray-900 rounded-2xl border-4 border-amber-400 p-6 shadow-xl"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="bg-amber-400 p-1.5 rounded-lg text-gray-900">
                <Wand2 size={16} />
              </div>
              <h3 className="text-sm font-black text-white uppercase tracking-widest">
                2. Copy Otimizada (ElevenLabs)
              </h3>
              {isOptimizedDirty && (
                <span className="text-xs text-orange-300 font-bold">
                  • Não salvo
                </span>
              )}
            </div>
            <button
              onClick={handleOptimize}
              disabled={isOptimizing || isApprovedDirty}
              className="text-xs text-amber-300 hover:text-amber-200 font-bold uppercase tracking-widest disabled:opacity-50"
              title="Refazer otimização"
            >
              {isOptimizing ? (
                <Loader2 className="animate-spin inline" size={12} />
              ) : (
                "↻ Refazer"
              )}
            </button>
          </div>
          <textarea
            value={optimizedScript}
            onChange={(e) => setOptimizedScript(e.target.value)}
            rows={6}
            className="w-full bg-gray-800 text-white text-base rounded-xl p-4 border-2 border-gray-700 focus:border-amber-400 outline-none leading-relaxed font-mono resize-y"
          />
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-amber-300">
              ✨ Texto com pausas, ênfases e ritmo natural para o ElevenLabs.
            </p>
            <button
              onClick={handleSaveOptimized}
              disabled={!isOptimizedDirty}
              className="px-6 py-2.5 bg-green-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-all shadow-lg flex items-center gap-2"
            >
              <CheckCircle2 size={14} />
              Salvar
            </button>
          </div>
        </motion.div>
      )}

      {/* STEP 3: gating messages */}
      {!optimizedScript && approvedScript && (
        <div className="mb-8 p-6 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 text-center">
          <p className="text-sm text-gray-400">
            ⬆ Otimize a copy primeiro para liberar a escolha de voz
          </p>
        </div>
      )}
      {optimizedScript && isOptimizedDirty && (
        <div className="mb-8 p-6 bg-orange-50 rounded-2xl border-2 border-dashed border-orange-200 text-center">
          <p className="text-sm text-orange-600 font-bold">
            ⬆ Salve a copy otimizada para liberar a escolha de voz
          </p>
        </div>
      )}

      {optimizedScript && !isOptimizedDirty && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="bg-purple-600 p-1.5 rounded-lg text-white">
              <Music size={16} />
            </div>
            <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">
              3. Escolha como gerar a voz
            </h3>
          </div>
        </div>
      )}

      {/* Mode selector */}
      {optimizedScript && !isOptimizedDirty && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {MODES.map((m) => {
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => {
                  setMode(m.id);
                  setDone(false);
                  setLocalAudioUrl("");
                }}
                className={`relative text-left rounded-2xl p-6 border-2 transition-all ${active ? "border-purple-500 bg-purple-50/40 shadow-sm" : "border-gray-100 hover:border-gray-300 bg-white"}`}
              >
                {active && (
                  <CheckCircle2
                    size={20}
                    className="absolute top-4 right-4 text-purple-500"
                  />
                )}
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className={active ? "text-purple-600" : "text-gray-500"}
                  >
                    {m.icon}
                  </span>
                  <span className="font-medium text-gray-900">{m.label}</span>
                </div>
                <p className="text-sm text-gray-500">{m.desc}</p>
              </button>
            );
          })}
        </div>
      )}

      {optimizedScript && !isOptimizedDirty && (
        <AnimatePresence mode="wait">
          <motion.div
            key={mode}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {/* ── CATALOG ── */}
            {mode === "catalog" && (
              <div className="space-y-6">
                {/* Filters */}
                <div className="bg-white rounded-2xl border border-gray-100 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Filter size={16} className="text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">
                      Filtros
                    </span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs text-gray-400 w-16 pt-1.5">
                        Sexo
                      </span>
                      {GENDERS.map((g) =>
                        filterBtn(
                          g.v,
                          filters.gender || "",
                          (v) =>
                            setFilters((f) => ({ ...f, gender: v as any })),
                          g.l,
                        ),
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs text-gray-400 w-16 pt-1.5">
                        Idade
                      </span>
                      {AGES.map((a) =>
                        filterBtn(
                          a.v,
                          filters.age || "",
                          (v) => setFilters((f) => ({ ...f, age: v as any })),
                          a.l,
                        ),
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <span className="text-xs text-gray-400 w-16 pt-1.5">
                        Idioma
                      </span>
                      {LANGUAGES.map((l) =>
                        filterBtn(
                          l.v,
                          filters.language || "",
                          (v) => setFilters((f) => ({ ...f, language: v })),
                          l.l,
                          true,
                        ),
                      )}
                      {detectedLanguage && (
                        <span className="text-xs text-purple-500 bg-purple-50 px-2 py-0.5 rounded-full">
                          detectado do roteiro
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      <span className="text-xs text-gray-400 w-16 pt-1.5">
                        Uso
                      </span>
                      {USE_CASES.map((u) =>
                        filterBtn(
                          u.v,
                          filters.use_case || "",
                          (v) => setFilters((f) => ({ ...f, use_case: v })),
                          u.l,
                        ),
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Search size={14} className="text-gray-400" />
                      <input
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder="Buscar por nome ou característica..."
                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-purple-400"
                      />
                    </div>
                  </div>
                </div>

                {/* Voice list */}
                <div className="bg-white rounded-2xl border border-gray-100 p-5">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">
                    {loadingVoices
                      ? "Carregando..."
                      : `${voices.length} vozes encontradas`}
                  </h4>
                  {loadingVoices ? (
                    <div className="flex items-center justify-center py-12 text-gray-400">
                      <Loader2 size={20} className="animate-spin mr-2" />{" "}
                      Carregando vozes...
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                      {voices.map((v) => (
                        <div
                          key={v.voice_id}
                          onClick={() => setSelectedVoice(v)}
                          className={`text-left rounded-xl p-4 border-2 transition cursor-pointer ${selectedVoice?.voice_id === v.voice_id ? "border-purple-500 bg-purple-50/30" : "border-gray-100 hover:border-gray-300"}`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-sm text-gray-900 truncate">
                              {v.name}
                            </span>
                            {v.preview_url && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  new Audio(v.preview_url).play();
                                }}
                                className="p-1 rounded-full hover:bg-gray-100"
                              >
                                <Play size={14} className="text-gray-500" />
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {v.labels?.gender && (
                              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                {v.labels.gender}
                              </span>
                            )}
                            {v.labels?.age && (
                              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                {v.labels.age}
                              </span>
                            )}
                            {v.labels?.language && (
                              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                {v.labels.language}
                              </span>
                            )}
                            {v.labels?.use_case && (
                              <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                                {v.labels.use_case}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleGenerateCatalog}
                    disabled={!selectedVoice || generating}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition ${!selectedVoice || generating ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-gray-900 text-white hover:bg-black"}`}
                  >
                    {generating ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Gerando...
                      </>
                    ) : (
                      <>
                        <Play size={18} />
                        Gerar áudio
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ── CLONE ── */}
            {mode === "clone" && (
              <div className="space-y-6">
                {/* Orientações */}
                <div className="bg-blue-50 rounded-2xl border border-blue-100 p-5">
                  <h4 className="text-sm font-semibold text-blue-900 mb-3">
                    Antes de começar
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <p className="text-sm text-blue-800">
                      🎙 Fale como quer soar nos anúncios
                    </p>
                    <p className="text-sm text-blue-800">
                      🔇 Ambiente silencioso, sem música
                    </p>
                    <p className="text-sm text-blue-800">
                      ⏱ Entre 1 e 2 minutos é o ideal
                    </p>
                    <p className="text-sm text-blue-800">
                      📱 Microfone do celular funciona bem
                    </p>
                  </div>
                </div>

                {/* Toggle gravar / upload */}
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <div className="flex gap-3 mb-6">
                    <button
                      onClick={() => {
                        setCloneMode("record");
                        setCloneFile(null);
                        setRecordedBlob(null);
                        setRecordingSeconds(0);
                      }}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium border-2 transition ${cloneMode === "record" ? "border-purple-500 bg-purple-50 text-purple-700" : "border-gray-100 text-gray-600 hover:border-gray-300"}`}
                    >
                      🎙 Gravar agora
                    </button>
                    <button
                      onClick={() => {
                        setCloneMode("upload");
                        setRecordedBlob(null);
                        setRecordingSeconds(0);
                        if (isRecording) stopRecording();
                      }}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium border-2 transition ${cloneMode === "upload" ? "border-purple-500 bg-purple-50 text-purple-700" : "border-gray-100 text-gray-600 hover:border-gray-300"}`}
                    >
                      📁 Fazer upload
                    </button>
                  </div>

                  {/* GRAVAR */}
                  {cloneMode === "record" && (
                    <div className="text-center space-y-4">
                      {/* Estado inicial */}
                      {!isRecording && !recordedBlob && (
                        <div>
                          <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-purple-50 border-2 border-purple-200 flex items-center justify-center">
                            <Mic size={36} className="text-purple-400" />
                          </div>
                          <p className="text-sm text-gray-500 mb-6">
                            Clique para começar. A gravação para automaticamente
                            aos 2 minutos.
                          </p>
                          <button
                            onClick={startRecording}
                            className="px-10 py-3 rounded-xl bg-purple-600 text-white font-medium hover:bg-purple-700 transition text-sm"
                          >
                            Iniciar gravação
                          </button>
                        </div>
                      )}

                      {/* Gravando */}
                      {isRecording && (
                        <div>
                          <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-red-50 border-2 border-red-300 flex items-center justify-center animate-pulse">
                            <Mic size={36} className="text-red-500" />
                          </div>
                          <div className="text-3xl font-mono font-bold text-gray-800 mb-3">
                            {String(Math.floor(recordingSeconds / 60)).padStart(
                              2,
                              "0",
                            )}
                            :{String(recordingSeconds % 60).padStart(2, "0")}
                          </div>
                          <div className="w-full max-w-xs mx-auto bg-gray-100 rounded-full h-2 mb-2">
                            <div
                              className="h-2 rounded-full transition-all duration-1000"
                              style={{
                                width: `${Math.min((recordingSeconds / 120) * 100, 100)}%`,
                                backgroundColor:
                                  recordingSeconds < 60
                                    ? "#a855f7"
                                    : recordingSeconds < 100
                                      ? "#22c55e"
                                      : "#f97316",
                              }}
                            />
                          </div>
                          <p className="text-xs text-gray-400 mb-6">
                            {recordingSeconds < 60
                              ? `Continue falando... mínimo recomendado: 1 minuto`
                              : recordingSeconds < 100
                                ? "✅ Ótimo! Pode parar quando quiser"
                                : "🟠 Quase no limite — encerrando em breve"}
                          </p>
                          <button
                            onClick={stopRecording}
                            className="px-10 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition text-sm"
                          >
                            Parar gravação
                          </button>
                        </div>
                      )}

                      {/* Gravação concluída */}
                      {recordedBlob && !isRecording && (
                        <div>
                          <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-green-50 border-2 border-green-300 flex items-center justify-center">
                            <CheckCircle2
                              size={36}
                              className="text-green-500"
                            />
                          </div>
                          <p className="text-sm font-medium text-gray-800 mb-1">
                            Gravação concluída
                          </p>
                          <p className="text-xs text-gray-400 mb-4">
                            {Math.floor(recordingSeconds / 60)}min{" "}
                            {recordingSeconds % 60}s gravados
                          </p>
                          <audio
                            controls
                            src={URL.createObjectURL(recordedBlob)}
                            className="w-full max-w-sm mx-auto mb-4"
                          />
                          <button
                            onClick={() => {
                              setRecordedBlob(null);
                              setRecordingSeconds(0);
                            }}
                            className="text-xs text-gray-400 hover:text-gray-600 underline"
                          >
                            Gravar novamente
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* UPLOAD */}
                  {cloneMode === "upload" && (
                    <div>
                      {!cloneFile ? (
                        <label className="block cursor-pointer">
                          <input
                            type="file"
                            accept="audio/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const audio = new Audio(
                                URL.createObjectURL(file),
                              );
                              audio.onloadedmetadata = () => {
                                const dur = audio.duration;
                                if (dur < 30) {
                                  toast.error(
                                    "Áudio muito curto. Grave pelo menos 1 minuto.",
                                  );
                                  return;
                                }
                                if (dur > 200) {
                                  toast(
                                    "Áudio longo demais. O ideal é até 2 minutos — o excesso será ignorado.",
                                  );
                                }
                                setCloneFile(file);
                              };
                            }}
                          />
                          <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center hover:border-purple-300 transition">
                            <Upload
                              size={28}
                              className="mx-auto text-gray-400 mb-2"
                            />
                            <p className="text-sm text-gray-600">
                              Clique para enviar o áudio
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                              MP3 ou WAV · entre 1 e 2 minutos
                            </p>
                          </div>
                        </label>
                      ) : (
                        <div>
                          <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4 mb-3">
                            <CheckCircle2
                              size={20}
                              className="text-green-500"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">
                                {cloneFile.name}
                              </p>
                              <p className="text-xs text-gray-500">
                                {(cloneFile.size / 1024 / 1024).toFixed(1)} MB
                              </p>
                            </div>
                            <button onClick={() => setCloneFile(null)}>
                              <X size={16} className="text-gray-400" />
                            </button>
                          </div>
                          <audio
                            controls
                            src={URL.createObjectURL(cloneFile)}
                            className="w-full"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Nome da voz */}
                <div className="bg-white rounded-2xl border border-gray-100 p-5">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nome da voz clonada
                  </label>
                  <input
                    value={cloneName}
                    onChange={(e) => setCloneName(e.target.value)}
                    placeholder={`Minha voz — ${new Date().toLocaleDateString("pt-BR")}`}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-purple-400"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Este nome aparece no seu histórico de vozes clonadas.
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleCloneAndGenerate}
                    disabled={
                      (!recordedBlob && !cloneFile) || !cloneName || cloning
                    }
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition ${(!recordedBlob && !cloneFile) || !cloneName || cloning ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-gray-900 text-white hover:bg-black"}`}
                  >
                    {cloning ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Clonando e gerando...
                      </>
                    ) : (
                      <>
                        <Mic size={18} />
                        Clonar e gerar áudio
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ── READY AUDIO ── */}
            {mode === "ready" && (
              <div className="space-y-6">
                <div className="bg-white rounded-2xl border border-gray-100 p-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-1">
                    Envie o áudio pronto
                  </h4>
                  <p className="text-xs text-gray-500 mb-4">
                    O áudio já deve conter o roteiro completo do anúncio
                    gravado.
                  </p>
                  {!readyFile ? (
                    <label className="block cursor-pointer">
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) =>
                          e.target.files?.[0] && setReadyFile(e.target.files[0])
                        }
                      />
                      <div className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center hover:border-gray-400 transition">
                        <Upload
                          size={28}
                          className="mx-auto text-gray-400 mb-2"
                        />
                        <p className="text-sm text-gray-600">
                          Clique para enviar o áudio pronto
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          MP3, WAV, M4A
                        </p>
                      </div>
                    </label>
                  ) : (
                    <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                      <Upload size={18} className="text-gray-500" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">
                          {readyFile.name}
                        </p>
                        <p className="text-xs text-gray-400">
                          {(readyFile.size / 1024 / 1024).toFixed(1)} MB
                        </p>
                      </div>
                      <button onClick={() => setReadyFile(null)}>
                        <X size={16} className="text-gray-400" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="bg-white rounded-2xl border border-gray-100 p-5">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="cleanNoise"
                      checked={cleanNoise}
                      onChange={(e) => setCleanNoise(e.target.checked)}
                      className="rounded"
                    />
                    <div>
                      <label
                        htmlFor="cleanNoise"
                        className="text-sm font-medium text-gray-700 cursor-pointer"
                      >
                        Limpar ruído automaticamente
                      </label>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Remove ruído de fundo, reverb e interferências —
                        $0.12/min
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleReadyAudio}
                    disabled={!readyFile || cleaning || uploading}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition ${!readyFile || cleaning || uploading ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-gray-900 text-white hover:bg-black"}`}
                  >
                    {cleaning ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Limpando áudio...
                      </>
                    ) : uploading ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      <>
                        <Upload size={18} />
                        Usar este áudio
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Language warning modal */}
            {langWarning && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
                >
                  <h3 className="font-semibold text-gray-900 mb-2">
                    ⚠️ Idioma diferente do roteiro
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Seu roteiro foi detectado em{" "}
                    <strong>
                      {detectedLanguage === "pt"
                        ? "Português"
                        : detectedLanguage === "en"
                          ? "Inglês"
                          : "Espanhol"}
                    </strong>
                    . Usar uma voz em outro idioma pode fazer o avatar soar
                    artificial e prejudicar a performance do anúncio.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setLangWarning(false);
                        setPendingLanguage("");
                      }}
                      className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 transition"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => {
                        setFilters((f) => ({
                          ...f,
                          language: pendingLanguage,
                        }));
                        setLangWarning(false);
                        setPendingLanguage("");
                      }}
                      className="flex-1 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm hover:bg-black transition"
                    >
                      Continuar mesmo assim
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}

            {/* ── ACTIVE AUDIO ── */}
            {done && localAudioUrl && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 bg-green-50 rounded-2xl border border-green-200 p-5"
              >
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 size={18} className="text-green-600" />
                  <span className="text-sm font-medium text-green-800">
                    Áudio ativo
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <audio controls src={localAudioUrl} className="flex-1" />
                  <button
                    onClick={() => setShowRemoveActiveModal(true)}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors rounded-xl hover:bg-red-50 flex-shrink-0"
                    title="Remover áudio ativo"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </motion.div>
            )}

            {/* ── HISTORY (independent of active audio) ── */}
            {savedAudios.length >= 1 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 bg-white rounded-2xl border border-gray-100 p-5"
              >
                <p className="text-xs font-medium text-gray-600 mb-3">
                  Histórico de áudios ({savedAudios.length})
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {savedAudios.map((a, i) => (
                    <div
                      key={`${a.url}-${i}`}
                      className={`flex items-center gap-3 p-2 rounded-lg border ${a.url === localAudioUrl ? "border-green-300 bg-green-50" : "border-gray-100 bg-white"}`}
                    >
                      <audio controls src={a.url} className="flex-1 h-8" />
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {new Date(a.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                      {a.url !== localAudioUrl && (
                        <button
                          onClick={() => {
                            setLocalAudioUrl(a.url);
                            setDone(true);
                            onAudioReady?.(a.url, a.voiceId, a.storagePath);
                          }}
                          className="text-xs px-2 py-1 rounded-lg bg-gray-900 text-white hover:bg-black transition flex-shrink-0"
                        >
                          Usar
                        </button>
                      )}
                      <button
                        onClick={() =>
                          onDeleteAudioFromHistory?.(a.url, a.storagePath)
                        }
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 flex-shrink-0"
                        title="Deletar do histórico"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* ─── BOTÃO GERAR VÍDEO ─── */}
      <div className="mt-8 bg-gray-900 rounded-3xl p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-4">
          <div className="bg-amber-400 p-1.5 rounded-lg text-gray-900">
            <Sparkles size={16} />
          </div>
          <h3 className="text-sm font-black text-white uppercase tracking-widest">
            Próximo Passo
          </h3>
          {!localAudioUrl && (
            <span className="ml-auto text-xs text-orange-300 font-bold">
              ⚠ Selecione um áudio primeiro
            </span>
          )}
          {localAudioUrl && (
            <span className="ml-auto text-xs text-green-300 font-bold">
              ✅ Áudio selecionado
            </span>
          )}
        </div>
        {!localAudioUrl && (
          <p className="text-xs text-white/50 mb-4">
            Gere ou selecione um áudio acima para liberar o próximo passo.
          </p>
        )}
        <button
          onClick={() => (localAudioUrl ? onGoToVideo?.() : null)}
          className={`w-full py-5 rounded-2xl font-black text-base uppercase tracking-widest transition-all flex items-center justify-center gap-3 ${
            localAudioUrl
              ? "bg-blue-600 hover:bg-blue-700 text-white shadow-xl shadow-blue-900/30 cursor-pointer"
              : "bg-gray-800 text-gray-600 cursor-not-allowed"
          }`}
        >
          <Film size={20} />
          Gerar Vídeo
        </button>
      </div>

      {showRemoveActiveModal && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          style={{ zIndex: 99999 }}
          onClick={() => setShowRemoveActiveModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900">
                  Remover áudio ativo?
                </h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  Não vai apagar do histórico.
                </p>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowRemoveActiveModal(false)}
                className="flex-1 px-4 py-2 rounded-xl font-bold text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  setLocalAudioUrl("");
                  setDone(false);
                  onAudioReady?.("", "", null);
                  setShowRemoveActiveModal(false);
                }}
                className="flex-1 px-4 py-2 rounded-xl font-bold text-sm bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Sim, remover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VozPremium;
