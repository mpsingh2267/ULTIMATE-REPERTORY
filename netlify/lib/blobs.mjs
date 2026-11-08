/**
 * Shared Netlify Blobs helpers for Lambda-compatible (v1) functions.
 * v1 handlers must call connectBlobs(event) before using getStore(),
 * otherwise @netlify/blobs throws MissingBlobsEnvironmentError.
 */
import { connectLambda, getStore } from '@netlify/blobs';

export function connectBlobs(event) {
  try {
    if (event && event.blobs) connectLambda(event);
  } catch (err) {
    console.error('connectLambda failed:', err);
  }
}

export async function getBlobsStore(name) {
  try {
    return getStore(name);
  } catch (err) {
    console.error(`Blobs store "${name}" unavailable:`, err.message);
    return null;
  }
}
