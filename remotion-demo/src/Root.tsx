import React from "react";
import { Composition } from "remotion";
import { DemoMold, demoMoldSchema, defaultDemoProps } from "./DemoMold";

// Aqui o molde é "registrado": 15s (450 frames a 30fps), vertical 1080x1920 (Reels).
// O `schema` faz o Remotion Studio mostrar um FORMULÁRIO editável na direita —
// é ali que o usuário "coloca as coisas dele" e vê o vídeo mudar na hora.
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="DemoMold"
      component={DemoMold}
      schema={demoMoldSchema}
      durationInFrames={450}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaultDemoProps}
    />
  );
};
