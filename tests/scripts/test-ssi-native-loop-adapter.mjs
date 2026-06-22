import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runtimePackageAbility } from '../../.github/scripts/lib/ci-runtime-utils.mjs';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);
const runtimeContractEnv = { HOMEBOY_AGENT_RUNTIME_TASK_ABILITY: 'runtime-package/run' };
const runtimePackageAbilityId = runtimePackageAbility(runtimeContractEnv);
const tempDir = await mkdtemp(path.join(tmpdir(), 'wpsg-ssi-native-loop-'));
const settingsPath = path.join(tempDir, 'settings.json');
const sourceStaticSiteDir = path.join(tempDir, 'issue-123-native-loop');
const materializedRoot = path.join(tempDir, 'materialized-static-site-candidates');

await mkdir(path.join(sourceStaticSiteDir, 'assets'), { recursive: true });
await writeFile(path.join(sourceStaticSiteDir, 'index.html'), '<!doctype html><html><body>Native loop</body></html>');
await writeFile(path.join(sourceStaticSiteDir, 'assets/styles.css'), 'body { color: #111; }');
const workflowPath = path.join(tempDir, 'workflow.json');
const controllerPath = path.join(tempDir, 'controller.json');

const controllerResult = spawnSync(process.execPath, ['.github/scripts/build-homeboy-ssi-loop-controller.mjs', '--output', controllerPath], {
	cwd: repoRoot,
	encoding: 'utf8',
	env: { ...process.env, ...runtimeContractEnv },
});
assert.equal(controllerResult.status, 0, controllerResult.stderr || controllerResult.stdout);

const controller = JSON.parse(await readFile(controllerPath, 'utf8'));
assert.equal(controller.schema, 'homeboy/agent-task-loop-spec/v1', 'native controller builder emits a Homeboy from-spec loop contract');
assert.equal(controller.loop_id, 'wp-site-generator/static-site-generation-loop', 'controller records the Homeboy loop id');
assert.equal(controller.config_version, 'wpsg-ssi-loop-v1', 'controller records the WPSG declaration version');
assert.equal(controller.metadata.authority.builder, '.github/scripts/build-homeboy-ssi-loop-controller.mjs', 'controller records its repo-owned builder');
assert.equal(controller.metadata.authority.contract_issue, 'https://github.com/Extra-Chill/homeboy/issues/4658', 'controller records the upstream contract issue');
assert.equal(controller.metadata.authority.controller_primitives, 'https://github.com/Extra-Chill/homeboy/pull/5152', 'controller records the Homeboy controller primitive dependency');
assert.deepEqual(controller.metadata.authority.homeboy_from_spec, ['https://github.com/Extra-Chill/homeboy/issues/4722', 'https://github.com/Extra-Chill/homeboy/issues/4723'], 'controller records the Homeboy from-spec ingestion alignment issues');
assert.equal(controller.metadata.authority.execution_surface, undefined, 'controller spec does not select a Homeboy execution surface');
assert.equal(controller.execution, undefined, 'controller spec does not carry backend abstraction details');
assert.equal(controller.runtime, undefined, 'controller spec does not embed runtime backend configuration');
assert.equal(controller.metadata.authority.action_types, undefined, 'controller spec does not define Homeboy action vocabulary');
assert.equal(controller.state, undefined, 'controller spec does not own Homeboy state');
assert.equal(controller.events, undefined, 'controller spec does not own Homeboy lineage events');
assert.equal(controller.backend, undefined, 'controller spec does not name a backend');
assert.equal(controller.provider, undefined, 'controller spec does not name a provider');
assert.equal(controller.phases, undefined, 'controller spec does not define Homeboy execution phases');
assert.equal(controller.blockers, undefined, 'controller spec does not encode upstream execution blockers');
assert.equal(controller.ingredients, undefined, 'controller exposes declaration groups directly');
assert.equal(controller.policy, undefined, 'controller spec does not encode Homeboy transition policy');
assert.equal(controller.actions, undefined, 'controller spec does not enqueue Homeboy actions directly');
assert.equal(controller.initial_event, undefined, 'controller spec does not seed Homeboy events');
assert.equal(controller.agents.find((agent) => agent.agent_id === 'static_site').metadata.slug, 'static-site-agent', 'controller declares WPSG agents in repo-domain terms');
assert.ok(controller.abilities.some((ability) => ability.ability_id === runtimePackageAbilityId), 'controller declares required generic runtime package ability contracts');
assert.ok(controller.workflows.every((workflow) => workflow.prompt || workflow.tasks?.length), 'each workflow is ingestible by Homeboy from-spec dispatch');
assert.deepEqual(controller.workflows.filter((workflow) => workflow.agent_id).map((workflow) => workflow.agent_id), ['store_idea', 'website_idea', 'design_store', 'design_website', 'static_store', 'static_site', 'php_transformer_iterator', 'ssi_stack_reviewer'], 'agent-backed workflows declare agent participation');
assert.equal(controller.agents.find((agent) => agent.agent_id === 'design_store').metadata.bundle, 'bundles/design-agent', 'design-store uses the checked-in design bundle');
assert.equal(controller.workflows.find((workflow) => workflow.workflow_id === 'store-idea').runtime_execution.input.workflow.id, 'store-idea-artifact-flow', 'store idea selects the artifact workflow');
assert.equal(controller.workflows.find((workflow) => workflow.workflow_id === 'website-idea').runtime_execution.input.workflow.id, 'website-idea-artifact-flow', 'website idea selects the artifact workflow');
assert.equal(controller.workflows.find((workflow) => workflow.workflow_id === 'design-store').runtime_execution.input.workflow.id, 'design-artifact-flow', 'design workflow selects the artifact workflow');
assert.equal(controller.workflows.find((workflow) => workflow.workflow_id === 'static-site').runtime_execution.input.workflow.id, 'static-site-candidate-flow', 'static workflow selects the candidate artifact workflow');
assert.equal(controller.workflows.find((workflow) => workflow.workflow_id === 'store-idea').abilities.includes('github_issue_publish'), false, 'concept artifact workflows do not publish GitHub issues');
assert.equal(controller.workflows.find((workflow) => workflow.workflow_id === 'static-site').abilities.includes('github_pull_request_publish'), false, 'candidate artifact workflows do not publish GitHub pull requests');
assert.deepEqual(controller.workflows.find((workflow) => workflow.workflow_id === 'static-validation').artifacts.slice(0, 1), ['static_site_candidate'], 'static validation declares candidate artifact dependencies');
assert.deepEqual(controller.workflows.find((workflow) => workflow.workflow_id === 'static-publication').emits, ['static_site_pull_request'], 'static publication emits the generated PR artifact');
assert.deepEqual(controller.workflows.find((workflow) => workflow.workflow_id === 'revalidation').consumes, ['static_site_candidate', 'import_validation_result', 'visual_parity_artifact', 'finding_packet_set'], 'revalidation consumes artifact evidence instead of PR transport');
assert.deepEqual(controller.workflows.find((workflow) => workflow.workflow_id === 'reviewer').consumes, ['static_site_candidate', 'import_validation_result', 'static_validation_run', 'visual_parity_artifact', 'finding_packet_set', 'revalidation_attempt'], 'reviewer consumes artifact evidence instead of PR transport');
assert.equal(controller.artifacts.find((artifact) => artifact.artifact_id === 'static_site_pull_request').evidence_only, true, 'generated PR is optional publication evidence');
assert.deepEqual(controller.workflows.find((workflow) => workflow.workflow_id === 'iterator').artifacts.slice(-2), ['iterator_upstream_issue', 'iterator_upstream_pull_request'], 'iterator workflow declares emitted artifacts');
assert.ok(controller.workflows.find((workflow) => workflow.workflow_id === 'iterator').dependencies.includes('homeboy-extensions'), 'iterator routing can target Homeboy Extensions runtime findings');
assert.equal(controller.workflows.find((workflow) => workflow.workflow_id === 'iterator').builder, undefined, 'iterator workflow does not expose backend-specific builder policy');
assert.equal(controller.artifacts.find((artifact) => artifact.artifact_id === 'revalidation_attempt').kind, 'wp-site-generator/RevalidationAttempt/v1', 'controller declares artifact schemas');
assert.ok(controller.dependencies.some((dependency) => dependency.value === 'chubes4/static-site-importer'), 'controller declares SSI stack dependencies');
assert.ok(controller.dependencies.some((dependency) => dependency.value === 'Extra-Chill/homeboy-extensions'), 'controller declares upstream Homeboy Extensions owner for runtime workload findings');
assert.equal(controller.metrics.find((metric) => metric.metric_id === 'fallback_blocks').target, 'value === 0', 'fallback block metric gate is explicit');
assert.equal(controller.metrics.find((metric) => metric.metric_id === 'conversion_findings').target, 'value === 0', 'conversion finding metric gate is explicit');
assert.equal(controller.metrics.find((metric) => metric.metric_id === 'visual_parity').target, 'status === "pass" && mismatch_count === 0 && max_delta_ratio === 0', 'visual parity metric gate is explicit');
assert.equal(controller.gates.find((gate) => gate.gate_id === 'fallback_blocks').on_fail, undefined, 'gates do not encode Homeboy routing decisions');

const settingsResult = spawnSync(process.execPath, ['.github/scripts/build-static-validation-settings.mjs', '--site', 'issue-123-native-loop', '--source-static-site-dir', sourceStaticSiteDir, '--materialized-root', materializedRoot, '--output', settingsPath], {
	cwd: repoRoot,
	encoding: 'utf8',
});
assert.equal(settingsResult.status, 0, settingsResult.stderr || settingsResult.stdout);

const settingsPayload = JSON.parse(await readFile(settingsPath, 'utf8'));
assert.equal(settingsPayload.workloads[0].id, 'ssi-import', 'native validation adapter emits SSI bench workload');
assert.equal(settingsPayload.workloads[0].run[0].type, 'php', 'workload probes through PHP');
assert.match(settingsPayload.workloads[0].run[0].code, /blocks_engine_php_transformer_compile_artifact|Automattic\\\\BlocksEngine\\\\PhpTransformer/, 'workload probes Blocks Engine php-transformer helpers/classes before import');
assert.equal(settingsPayload.workloads[0].run[1].type, 'php', 'workload imports through PHP');
assert.match(settingsPayload.workloads[0].run[1].code, /wp_get_ability\( 'static-site-importer\/import-website-artifact' \)/, 'workload runs SSI website artifact import ability');
assert.match(settingsPayload.workloads[0].run[1].code, /blocks_engine_php_transformer_compile_artifact|Automattic\\\\BlocksEngine\\\\PhpTransformer/, 'import path requires Blocks Engine php-transformer helpers/classes');
assert.doesNotMatch(settingsPayload.workloads[0].run[1].code, /static-site-importer import-theme/, 'workload does not depend on the SSI WP-CLI command');
assert.doesNotMatch(settingsPayload.workloads[0].run[1].code, /static-site-importer\/import-theme/, 'workload does not depend on the legacy import-theme ability');
assert.doesNotMatch(settingsPayload.workloads[0].run[1].code, /^<\?php/, 'inline PHP workload code omits an opening tag for eval execution');
assert.deepEqual(settingsPayload.website_artifact.files.map((file) => file.path), ['website/assets/styles.css', 'website/index.html'], 'validation settings pass candidate files as a website artifact');
assert.equal(settingsPayload.workloads[0].artifacts, undefined, 'runtime import report stays in workload metadata instead of a collectable bench artifact declaration');
assert.deepEqual(
	settingsPayload.settings.wordpress_runtime_blueprint.steps.map((step) => step.options.targetFolderName).slice(0, 3),
	['blocks-engine-php-transformer', 'static-site-importer'],
	'generic validation settings install Blocks Engine php-transformer before SSI without WooCommerce',
);

const commerceSettingsPath = path.join(tempDir, 'commerce-settings.json');
const commerceSettingsResult = spawnSync(process.execPath, ['.github/scripts/build-static-validation-settings.mjs', '--site', 'issue-123-native-loop', '--source-static-site-dir', sourceStaticSiteDir, '--materialized-root', materializedRoot, '--lane', 'woocommerce', '--output', commerceSettingsPath], {
	cwd: repoRoot,
	encoding: 'utf8',
});
assert.equal(commerceSettingsResult.status, 0, commerceSettingsResult.stderr || commerceSettingsResult.stdout);
const commerceSettingsPayload = JSON.parse(await readFile(commerceSettingsPath, 'utf8'));
assert.deepEqual(
	commerceSettingsPayload.settings.wordpress_runtime_blueprint.steps.map((step) => step.options.targetFolderName).slice(0, 4),
	['woocommerce', 'blocks-engine-php-transformer', 'static-site-importer'],
	'commerce validation settings install WooCommerce before the SSI stack',
);

const previewPath = path.join(tempDir, 'preview.json');
const previewResult = spawnSync(process.execPath, ['.github/scripts/build-static-preview-blueprint.mjs', '--site', 'issue-123-native-loop', '--source-repo', 'chubes4/wp-site-generator', '--source-head-sha', 'a'.repeat(40), '--output', previewPath], {
	cwd: repoRoot,
	encoding: 'utf8',
	env: { ...process.env, HOMEBOY_PREVIEW_EVIDENCE_REFS: JSON.stringify([{ preview_url: 'https://preview.example.test/issue-123-native-loop' }]) },
});
assert.equal(previewResult.status, 0, previewResult.stderr || previewResult.stdout);
const previewPayload = JSON.parse(await readFile(previewPath, 'utf8'));
const previewSourceStep = previewPayload.blueprint.steps.find((step) => step.step === 'writeFiles');
assert.equal(previewSourceStep.filesTree.ref, 'a'.repeat(40), 'preview blueprint consumes immutable head SHA when available');
assert.equal(previewSourceStep.filesTree.refType, 'commit', 'preview blueprint records commit ref type for immutable previews');
assert.equal(previewPayload.source.provenance, 'immutable-head-sha', 'preview output records immutable provenance');
assert.equal(previewPayload.url, 'https://preview.example.test/issue-123-native-loop', 'preview output consumes runtime preview evidence refs');

const fallbackPreviewResult = spawnSync(process.execPath, ['.github/scripts/build-static-preview-blueprint.mjs', '--site', 'issue-123-native-loop', '--output', path.join(tempDir, 'preview-fallback.json')], {
	cwd: repoRoot,
	encoding: 'utf8',
});
assert.notEqual(fallbackPreviewResult.status, 0, 'preview generation fails closed without immutable source provenance');
assert.match(fallbackPreviewResult.stderr, /SOURCE_HEAD_SHA, SOURCE_TAG, or SOURCE_ARTIFACT_SOURCE/, 'preview failure explains required immutable source inputs');

const groupResult = spawnSync(process.execPath, ['.github/scripts/group-ssi-finding-packets.mjs', 'tests/fixtures/ssi-finding-packets.json'], {
	cwd: repoRoot,
	encoding: 'utf8',
	env: { ...process.env, FINDING_GROUPS_PATH: path.join(tempDir, 'groups.json') },
});
assert.equal(groupResult.status, 0, groupResult.stderr || groupResult.stdout);

const workflowResult = spawnSync(process.execPath, ['bundles/php-transformer-iterator-agent/scripts/build-agent-iterator-workflow.mjs', path.join(tempDir, 'groups.json'), workflowPath], {
	cwd: repoRoot,
	encoding: 'utf8',
});
assert.equal(workflowResult.status, 0, workflowResult.stderr || workflowResult.stdout);

const validationWorkflow = await readFile(path.join(repoRoot, '.github/workflows/static-site-validation.yml'), 'utf8');
assert.match(validationWorkflow, /build-static-validation-settings\.mjs/, 'Actions validation uses shared Homeboy settings adapter');
assert.match(validationWorkflow, /build-static-preview-blueprint\.mjs/, 'Actions validation uses shared preview adapter');
assert.match(validationWorkflow, /gh workflow run php-transformer-iterator\.yml/, 'Actions validation dispatches iterator workflow with gh');
assert.match(validationWorkflow, /-f source_pr=/, 'Actions validation passes source PR to iterator workflow');

for (const workflowPath of ['.github/workflows/php-transformer-iterator.yml', '.github/workflows/php-transformer-iterator-smoke.yml', '.github/workflows/ssi-stack-reviewer.yml']) {
	const workflow = await readFile(path.join(repoRoot, workflowPath), 'utf8');
	assert.doesNotMatch(workflow, /agent_runtime:/, `${workflowPath} leaves runtime selection to reusable Agent CI`);
}

console.log('SSI native loop adapter contract passed');
