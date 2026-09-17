export type Session = {
  token: string;
  user?: { nombre_completo: string; rol: string };
};

export type Notice = { type: 'error' | 'success'; text: string } | null;
