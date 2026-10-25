import { BlobClient } from '@azure/storage-blob';
import {
  CreateArtifactRequest,
  CreateArtifactResponse,
  FinalizeArtifactRequest,
  FinalizeArtifactResponse,
} from './node_modules/@actions/artifact/lib/generated/results/api/v1/artifact.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';

const base = process.env.ACTIONS_RESULTS_URL;
const token = process.env.ACTIONS_RUNTIME_TOKEN;
if (!base || !token) throw new Error('missing-actions-runtime-context');

async function call(method, requestType, responseType, value) {
  const url = new URL(`/twirp/github.actions.results.api.v1.ArtifactService/${method}`, base);
  const request = requestType.create(value);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/protobuf',
      'User-Agent': 'repo-cassette-official-protobuf-probe',
    },
    body: requestType.toBinary(request),
  });
  const body = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) {
    let message = Buffer.from(body).toString('utf8').replace(/[\r\n]+/g, ' ').slice(0, 240);
    throw new Error(`${method}-http-${response.status}:${message}`);
  }
  return responseType.fromBinary(body);
}

const backend = getBackendIdsFromToken();
const name = `protobuf-mime-${process.env.GITHUB_RUN_ID}`;
const mime = '\u0085application/json';
let result;
try {
  const made = await call('CreateArtifact', CreateArtifactRequest, CreateArtifactResponse, {
    ...backend,
    name,
    version: 7,
    mimeType: StringValue.create({value: mime}),
  });
  if (!made.ok) throw new Error('create-not-ok');
  const body = Buffer.from(JSON.stringify({marker: name}));
  const block = new BlobClient(made.signedUploadUrl).getBlockBlobClient();
  await block.uploadData(body, {blobHTTPHeaders: {blobContentType: mime}});
  const done = await call('FinalizeArtifact', FinalizeArtifactRequest, FinalizeArtifactResponse, {
    ...backend,
    name,
    size: String(body.length),
  });
  if (!done.ok) throw new Error('finalize-not-ok');
  const first = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'repo-cassette-official-protobuf-probe',
      },
      redirect: 'manual',
    },
  );
  const location = first.headers.get('location');
  const final = location ? await fetch(location) : first;
  const bytes = Buffer.from(await final.arrayBuffer());
  const finalType = final.headers.get('content-type') || '';
  result = {
    artifactId: String(done.artifactId),
    firstStatus: first.status,
    finalStatus: final.status,
    finalTypeCodePoints: Array.from(finalType, c => c.codePointAt(0)),
    bodyMatches: bytes.equals(body),
  };
} catch (error) {
  result = {error: String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 300)};
}

console.log('PROTOBUF_MIME_RESULT', JSON.stringify(result));
