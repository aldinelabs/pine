// Plain text and bare numbers. Stubs until wave 5 replaces the bodies; the
// exports stay.
import type { MessageHandler, NumberHandler } from "./types";

export const handlePlainMessage: MessageHandler = () => Promise.resolve({});

export const handleNumber: NumberHandler = () => Promise.resolve({});
