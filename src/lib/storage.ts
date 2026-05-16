import { storage } from './firebase';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';

export const uploadBase64ToStorage = async (base64Data: string, path: string): Promise<string> => {
  // Check if it's actually base64
  if (!base64Data.startsWith('data:')) {
    return base64Data; // Already a URL or non-base64
  }

  // Extract base64 part
  const base64Content = base64Data.split(',')[1];
  const storageRef = ref(storage, path);
  
  await uploadString(storageRef, base64Content, 'base64');
  return await getDownloadURL(storageRef);
};
