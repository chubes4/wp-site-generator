import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export async function resolveStaticSiteCandidateSource({
	repoRoot = process.cwd(),
	site = '',
	candidatePath = '',
	sourceStaticSiteDir = '',
	materializedRoot = '.ci/static-site-candidates',
	requireIndex = false,
} = {}) {
	assertResolvedPath('STATIC_SITE_CANDIDATE_PATH', candidatePath);
	assertResolvedPath('SOURCE_STATIC_SITE_DIR', sourceStaticSiteDir);

	if (sourceStaticSiteDir) {
		let sourceDirectory = resolveInputPath(repoRoot, sourceStaticSiteDir);
		if (requireIndex) {
			await assertIndexHtml(sourceDirectory);
		}
		const siteSlug = slugify(site || path.basename(sourceDirectory));
		sourceDirectory = await materializeDirectoryIfNeeded({ repoRoot, sourceDirectory, site: siteSlug, materializedRoot });
		return sourceDescriptor({
			site: siteSlug,
			sourceDirectory,
			source: 'source-static-site-dir',
			repoRoot,
		});
	}

	if (!candidatePath) {
		if (!site) {
			throw new Error('SITE/--site, SOURCE_STATIC_SITE_DIR, or STATIC_SITE_CANDIDATE_PATH is required.');
		}
		const sourceDirectory = path.join(repoRoot, 'static-sites', site);
		if (requireIndex) {
			await assertIndexHtml(sourceDirectory);
		}
		return sourceDescriptor({ site, sourceDirectory, source: 'static-sites', repoRoot });
	}

	const resolvedCandidatePath = resolveInputPath(repoRoot, candidatePath);
	const candidateStat = await stat(resolvedCandidatePath);
	if (candidateStat.isDirectory()) {
		if (existsSync(path.join(resolvedCandidatePath, 'index.html'))) {
			if (requireIndex) {
				await assertIndexHtml(resolvedCandidatePath);
			}
			const siteSlug = slugify(site || path.basename(resolvedCandidatePath));
			const sourceDirectory = await materializeDirectoryIfNeeded({
				repoRoot,
				sourceDirectory: resolvedCandidatePath,
				site: siteSlug,
				materializedRoot,
			});
			return sourceDescriptor({
				site: siteSlug,
				sourceDirectory,
				source: 'materialized-candidate-directory',
				repoRoot,
			});
		}

		const candidateFile = await findCandidateJson(resolvedCandidatePath);
		if (!candidateFile) {
			throw new Error(`StaticSiteCandidate directory does not contain index.html or a candidate JSON file: ${resolvedCandidatePath}`);
		}
		return materializeCandidateFile({ repoRoot, site, candidatePath: candidateFile, materializedRoot });
	}

	return materializeCandidateFile({ repoRoot, site, candidatePath: resolvedCandidatePath, materializedRoot });
}

export async function buildWebsiteArtifactFromSource(candidateSource) {
	const files = await readSourceFiles(candidateSource.sourceDirectory);
	if (!files.some((file) => file.path === 'website/index.html')) {
		throw new Error(`StaticSiteCandidate source must include index.html: ${candidateSource.sourceDirectory}`);
	}

	return {
		schema: 'block-artifact-compiler/website-artifact/v1',
		files,
		metadata: {
			source: 'wp-site-generator/StaticSiteCandidate',
			site: candidateSource.site,
			candidate_source: candidateSource.source,
		},
	};
}

async function materializeCandidateFile({ repoRoot, site, candidatePath, materializedRoot }) {
	const candidate = unwrapCandidate(JSON.parse(await readFile(candidatePath, 'utf8')));
	const candidateSite = site || candidate.site_id || candidate.slug || candidate.site_slug || candidate.id || path.basename(candidatePath, path.extname(candidatePath));
	const siteSlug = slugify(candidateSite);
	if (!siteSlug) {
		throw new Error('StaticSiteCandidate must include site_id, slug, site_slug, or id when --site/SITE is not provided.');
	}

	const files = normalizeCandidateFiles(candidate);
	if (!files.some((file) => file.relativePath === 'index.html')) {
		throw new Error('StaticSiteCandidate must include index.html in files, file_set, or static_site.files.');
	}

	const outputRoot = resolveInputPath(repoRoot, materializedRoot);
	const sourceDirectory = path.join(outputRoot, siteSlug);
	await rm(sourceDirectory, { recursive: true, force: true });
	for (const file of files) {
		const outputPath = safeJoin(sourceDirectory, file.relativePath);
		await mkdir(path.dirname(outputPath), { recursive: true });
		await writeFile(outputPath, file.content);
	}

	return sourceDescriptor({
		site: siteSlug,
		sourceDirectory,
		source: 'static-site-candidate-json',
		candidatePath,
		repoRoot,
	});
}

async function materializeDirectoryIfNeeded({ repoRoot, sourceDirectory, site, materializedRoot }) {
	const relativePath = path.relative(repoRoot, sourceDirectory);
	if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
		return sourceDirectory;
	}
	const outputRoot = resolveInputPath(repoRoot, materializedRoot);
	const outputDirectory = path.join(outputRoot, site);
	await rm(outputDirectory, { recursive: true, force: true });
	await mkdir(path.dirname(outputDirectory), { recursive: true });
	await cp(sourceDirectory, outputDirectory, { recursive: true });
	return outputDirectory;
}

function sourceDescriptor({ site, sourceDirectory, source, candidatePath = '', repoRoot }) {
	const relativeSourceDirectory = path.relative(repoRoot, sourceDirectory).split(path.sep).join('/');
	return {
		site: slugify(site),
		source,
		sourceDirectory,
		relativeSourceDirectory,
		mountedSourceDirectory: `/wordpress/wp-content/plugins/wp-site-generator/${relativeSourceDirectory}`,
		candidatePath,
	};
}

function unwrapCandidate(value) {
	return value?.payload || value?.typed_artifacts?.static_site_candidate?.payload || value?.static_site_candidate || value;
}

function normalizeCandidateFiles(candidate) {
	const source = candidate?.files || candidate?.file_set || candidate?.static_site?.files || [];
	if (Array.isArray(source)) {
		return source.map((file) => normalizeFile(file.path || file.name || file.relative_path, file.content ?? file.body ?? ''));
	}
	if (source && typeof source === 'object') {
		return Object.entries(source).map(([relativePath, content]) => normalizeFile(relativePath, typeof content === 'object' ? content.content : content));
	}
	throw new Error('StaticSiteCandidate files must be an array or object.');
}

function normalizeFile(relativePath, content) {
	const normalizedPath = String(relativePath || '').replaceAll('\\', '/').replace(/^\.\//, '');
	if (!normalizedPath || normalizedPath.startsWith('/') || normalizedPath.includes('../') || normalizedPath === '..') {
		throw new Error(`Unsafe StaticSiteCandidate file path: ${relativePath}`);
	}
	return { relativePath: normalizedPath, content: String(content ?? '') };
}

async function findCandidateJson(directory) {
	const names = ['StaticSiteCandidate.json', 'static_site_candidate.json', 'static-site-candidate.json', 'candidate.json'];
	for (const name of names) {
		const filePath = path.join(directory, name);
		if (existsSync(filePath)) {
			return filePath;
		}
	}
	for (const entry of await readdir(directory)) {
		if (/candidate.*\.json$/i.test(entry)) {
			return path.join(directory, entry);
		}
	}
	return '';
}

async function assertIndexHtml(sourceDirectory) {
	if (!existsSync(path.join(sourceDirectory, 'index.html'))) {
		throw new Error(`Missing source static storefront: ${path.join(sourceDirectory, 'index.html')}`);
	}
}

async function readSourceFiles(sourceDirectory, relativeRoot = '') {
	const entries = await readdir(path.join(sourceDirectory, relativeRoot), { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			files.push(...await readSourceFiles(sourceDirectory, relativePath));
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		files.push({
			path: `website/${relativePath}`,
			content: await readFile(path.join(sourceDirectory, relativePath), 'utf8'),
		});
	}
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

function resolveInputPath(repoRoot, inputPath) {
	return path.isAbsolute(inputPath) ? inputPath : path.join(repoRoot, inputPath);
}

function assertResolvedPath(name, value) {
	if (String(value || '').includes('{{')) {
		throw new Error(`${name} was not resolved before validation: ${value}`);
	}
}

function safeJoin(root, relativePath) {
	const joined = path.join(root, relativePath);
	if (!joined.startsWith(`${root}${path.sep}`)) {
		throw new Error(`Unsafe StaticSiteCandidate file path: ${relativePath}`);
	}
	return joined;
}

function slugify(value) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
