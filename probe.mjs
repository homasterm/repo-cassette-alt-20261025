import { BlobClient } from '@azure/storage-blob';
import { internalArtifactTwirpClient } from './node_modules/@actions/artifact/lib/internal/shared/artifact-twirp-client.js';
import { getBackendIdsFromToken } from './node_modules/@actions/artifact/lib/internal/shared/util.js';
import { StringValue } from './node_modules/@actions/artifact/lib/generated/index.js';

const client = internalArtifactTwirpClient({maxAttempts: 1});
const backend = getBackendIdsFromToken();
const name = `nel-before-param-${process.env.GITHUB_RUN_ID}`;
const mime = `application/json\u0085;charset=utf-8`;
let result;
try {
  const made = await client.CreateArtifact({
    ...backend,
    name,
    version: 7,
    mimeType: StringValue.create({value: mime}),
  });
  if (!made.ok) throw new Error('create-not-ok');
  const body = Buffer.from(JSON.stringify({marker: name}));
  const block = new BlobClient(made.signedUploadUrl).getBlockBlobClient();
  await block.uploadData(body, {blobHTTPHeaders: {blobContentType: mime}});
  const done = await client.FinalizeArtifact({...backend, name, size: String(body.length)});
  if (!done.ok) throw new Error('finalize-not-ok');
  const first = await fetch(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/artifacts/${done.artifactId}/zip`,
    {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'repo-cassette-nel-before-parameter-probe',
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

console.log('NEL_BEFORE_PARAMETER_RESULT', JSON.stringify(result));
