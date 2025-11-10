       // --- State Management (Controls what the user sees) ---
        const SCREENS = {
            HOME: 'home',
            RESUME_INPUT: 'resume_input',
            JOB_INPUT: 'job_input',
            RESUME_RESULTS: 'resume_results',
            JOB_RESULTS: 'job_results'
        };
        let currentScreen = SCREENS.HOME; // Tracks the current view
        let activeTab = 'improvements'; // Tracks the active tab in results view
        const appDiv = document.getElementById('app'); // The main container
        
        // Internal state for data and messaging
        let validationMessage = '';
        let isLoading = false;
        let resumeAnalysisResults = null;
        let jobAnalysisResults = null;
        let selectedFile = null; // Stores the user's PDF file object


        // --- Navigation and Modal Functions ---

        /**
         * Navigates the application to a new screen.
         */
        function navigateTo(screen, newTab = 'atsScore') { 
            currentScreen = screen;
            validationMessage = ''; // Clear validation message on successful navigation
            
            // Reset file on navigation away from resume input/results
            if (screen === SCREENS.HOME || screen === SCREENS.JOB_INPUT) {
                selectedFile = null;
            }

            // Set default tab based on screen
            if (screen === SCREENS.RESUME_RESULTS) {
                activeTab = newTab;
            } else if (screen === SCREENS.JOB_RESULTS) {
                activeTab = 'skills_required';
            }
            
            render();
            // Scroll to top for new screen
            window.scrollTo(0, 0); 
        }

        /**
         * Changes the active tab on the results screen.
         */
        function setActiveTab(tab) {
            activeTab = tab;
            render();
        }
        
        /**
         * Opens a modal by removing the 'hidden' class.
         */
        function openModal(id) {
            const modal = document.getElementById(id);
            if (modal) {
                modal.classList.remove('hidden');
            }
        }

        /**
         * Closes a modal by adding the 'hidden' class.
         */
        function closeModal(id) {
            const modal = document.getElementById(id);
            if (modal) {
                modal.classList.add('hidden');
            }
        }

        /**
         * Checks if the input string is likely a relevant job role title and not gibberish.
         * This uses simple heuristics (length and character ratio) for a quick check.
         * @param {string} input - The string to check.
         * @returns {boolean} True if the input seems relevant, false otherwise.
         */
        function isInputRelevant(input) {
            const trimmedInput = input.trim();
            const minLength = 5;
            
            if (trimmedInput.length < minLength) {
                return false;
            }

            // Count letters and spaces
            const letterOrSpaceCount = trimmedInput.replace(/[^a-zA-Z\s]/g, "").length;
            const totalLength = trimmedInput.length;

            // Reject if less than 50% of characters are letters or spaces
            if (letterOrSpaceCount / totalLength < 0.5) {
                return false;
            }

            return true;
        }

        // --- Gemini API Integration ---

        /**
         * Wrapper for fetch with exponential backoff for resilience against transient errors.
         */
        async function callGeminiAPI(systemPrompt, userQuery, responseSchema) {
    try {
        const response = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemPrompt, userQuery, responseSchema })
        });
        if (!response.ok) {
            throw new Error('Failed to reach backend API');
        }
        return await response.json();
    } catch (err) {
        console.error('Backend error:', err);
        validationMessage = "Error contacting AI server. Please try again later.";
        navigateTo(SCREENS.RESUME_INPUT);
        return null;
    }
}


        /**
         * Extracts text from a user-uploaded PDF file using pdf.js.
         */
        async function extractTextFromPDF(file) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });

            try {
                const pdf = await loadingTask.promise;
                let fullText = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n\n'; 
                }
                return fullText;
            } catch (error) {
                console.error('Error reading PDF:', error);
                throw new Error('Could not read PDF file. It might be corrupted or protected.');
            }
        }

        /**
         * Calls the Gemini API with a structured prompt and schema.
         */
        async function callGeminiAPI(systemPrompt, userQuery, responseSchema) {
            const apiKey = "AIzaSyASmkdwQkdqMkfs_wrEdzO-uAwZXR2wZls"; // API key is handled by the environment
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

            const payload = {
                contents: [{ parts: [{ text: userQuery }] }],
                systemInstruction: {
                    parts: [{ text: systemPrompt }]
                },
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema,
                }
            };

            const result = await fetchWithRetry(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            isLoading = false;

            if (result && result.candidates?.[0]?.content?.parts?.[0]?.text) {
                try {
                    const jsonString = result.candidates[0].content.parts[0].text;
                    return JSON.parse(jsonString);
                } catch (e) {
                    console.error("Failed to parse JSON response:", e);
                    // Critical error: Go back to the input screen to show the error
                    validationMessage = "Error processing AI response. Please try again.";
                    navigateTo(SCREENS.RESUME_INPUT);
                    return null;
                }
            } else {
                console.error("Invalid API response structure:", result);
                // Critical error: Go back to the input screen to show the error
                validationMessage = "Failed to get a response from AI. Please try again.";
                navigateTo(SCREENS.RESUME_INPUT);
                return null;
            }
        }
        
        // --- Component Utility Functions (HTML Generation) ---
        
        /**
         * Converts a simple array of strings into an unordered HTML list.
         */
        function formatArrayAsList(items) {
            if (!items || items.length === 0) {
                return '<p class="text-gray-400">No specific items found for this category.</p>';
            }
            return `
                <ul class="list-disc list-inside text-gray-300 mt-4 space-y-3 ml-4">
                    ${items.map(item => `<li class="leading-relaxed">${item}</li>`).join('')}
                </ul>
            `;
        }

        /**
         * Converts simple Markdown formatting (paragraphs, lists, bold) to HTML.
         */
        function simpleMarkdownToHtml(markdown) {
            if (!markdown) return '';
            
            let html = markdown
                // Convert **bold** to <strong>
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                // Convert ## Headings to strong tags with size/color
                .replace(/###\s*(.*)/g, '<h4 class="text-lg font-semibold text-orange-400 mt-4 mb-2">$1</h4>')
                .replace(/##\s*(.*)/g, '<h3 class="text-xl font-bold text-orange-500 mt-6 mb-3">$1</h3>')
                .replace(/#\s*(.*)/g, '<h2 class="text-2xl font-extrabold text-orange-500 mt-8 mb-4">$1</h2>');

            // Handle lists (simple bullet points)
            html = html.replace(/^\*\s*(.*)$/gm, '<li class="ml-6">$1</li>');
            
            if (html.includes('<li')) {
                 html = html.replace(/<li.*?>/g, '<UL_START><li>').replace(/<\/li>/g, '</li><UL_END>');
                 html = html.replace(/<UL_END><UL_START>/g, '');
                 html = html.replace(/<UL_START>/g, '<ul class="space-y-2 mb-4">').replace(/<UL_END>/g, '</ul>');
                 html = html.replace(/<\/ul>\s*<ul/g, '</ul><br><ul');
            }

            // Convert double newlines to paragraphs
            html = html.split('\n\n').map(p => {
                const trimmedP = p.trim();
                if (trimmedP.startsWith('<ul') || trimmedP.startsWith('<h') || trimmedP.startsWith('<li') || trimmedP.startsWith('<li>')) {
                    return trimmedP;
                }
                return trimmedP ? `<p class="leading-relaxed mb-4">${trimmedP}</p>` : '';
            }).join('');
            
            html = html.replace(/<UL_START>/g, '').replace(/<UL_END>/g, '');
            return `<div class="markdown-content">${html}</div>`;
        }

        /**
         * Formats the resources list with titles and descriptions.
         */
        function formatResourceList(items) {
             if (!items || items.length === 0) {
                return '<p class="text-gray-400">No specific resources found.</p>';
            }
            return `
                <ul class="text-gray-300 mt-4 space-y-4">
                    ${items.map(item => `
                        <li class="border-b border-gray-700 pb-3">
                            <strong class="text-orange-400 block">${item.title}</strong>
                            <p class="text-sm text-gray-400 leading-relaxed">${item.description}</p>
                        </li>
                    `).join('')}
                </ul>
            `;
        }

        // --- Validation & API Logic ---
        async function validateResumeInput() {
            const jobRoleInput = document.getElementById('job-role-input');
            const feedbackInput = document.getElementById('feedback-input');

            const jobRole = jobRoleInput ? jobRoleInput.value.trim() : '';
            const feedback = feedbackInput ? feedbackInput.value.trim() : '';
            const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

            let message = '';
            
            if (!selectedFile && !jobRole) {
                message = 'Please choose your <strong class="text-white font-semibold">Resume PDF</strong> and enter your target <strong class="text-white font-semibold">Job Role</strong> to continue.';
            } else if (!selectedFile) {
                message = 'Please choose your <strong class="text-white font-semibold">Resume PDF</strong>. It is required for the analysis.';
            } else if (selectedFile.type !== 'application/pdf') {
                 message = 'Invalid file type. Please upload a <strong class="text-white font-semibold">.pdf</strong> file.';
            } else if (selectedFile.size > MAX_FILE_SIZE) {
                message = 'File is too large. Maximum size is <strong class="text-white font-semibold">5MB</strong>.';
            } else if (!jobRole) {
                message = 'Please enter your target <strong class="text-white font-semibold">Job Role</strong>. This guides the analysis.';
            } else if (!isInputRelevant(jobRole)) { 
                message = 'The job role entered seems <strong class="text-white font-semibold">irrelevant or too vague</strong>. Please enter a proper job title (e.g., "Software Engineer Intern").';
            }

            if (message) {
                validationMessage = message;
                render(); 
                return;
            }

            const fileToProcess = selectedFile; 

            // Set loading state and navigate immediately to show loader
            isLoading = true;
            navigateTo(SCREENS.RESUME_RESULTS);
            
            let resumeText = '';
            try {
                resumeText = await extractTextFromPDF(fileToProcess);
            } catch (error) {
                console.error("PDF Extraction Failed:", error);
                validationMessage = error.message || 'Failed to extract text from PDF. Please try another file.';
                isLoading = false; 
                navigateTo(SCREENS.RESUME_INPUT); // Navigate back to show error message
                return;
            }

            // Define API inputs (No changes here, already optimized)
            const systemPrompt = "Act as an ATS scanning system + career advisor for Indian students applying to tech jobs in 2025. Analyze the resume text and job role given by the user and give clear, structured feedback. Keep your feedback realistic and honest, but not discouraging. Use the following structure:\n\n1. **ATS Score (out of 10)**\n    - Give a realistic ATS score based on formatting, keywords, clarity, and relevance to target job.\n    - 6/10 or lower → explain why clearly.\n\n2. **Resume Improvements**\n    - List 5–8 specific improvement points, not generic tips.\n    - Focus on action verbs, measurable outcomes, skill priority order, formatting, and section structure.\n    - Mention what should be removed or rewritten.\n\n3. **Career Roadmap & Next Steps**\n    - **In the response list for this section, first list all critical missing technical skills or projects** based on the target role and current market in India (2025).\n    - Then, recommend 2–3 projects to build next (based on their desired role).\n    - Mention 2–3 relevant certification or course names.\n    - Suggest platforms for DSA/CP if needed (e.g., LeetCode, GFG, HackerRank).\n\n❗Keep the response clear and broken down — no long paragraphs.\n❗Avoid generic sentences like “work on communication skills” unless truly necessary.\n❗All examples and suggestions should match India’s 2025 job market";
            
            const userQuery = `
                Here is my resume:
                ---
                ${resumeText}
                ---
                
                My target job role is: ${jobRole}
                
                ${feedback ? `Optional focus for analysis: ${feedback}` : ''}
            `;
            
            const schema = {
                type: "OBJECT",
                properties: {
                    atsScore: {
                        type: "OBJECT",
                        properties: {
                            score: { "type": "NUMBER" },
                            explanation: { "type": "STRING" }
                        }
                    },
                    resumeImprovements: {
                        type: "ARRAY",
                        items: { type: "STRING" }
                    },
                    suggestions: {
                        type: "ARRAY",
                        items: { type: "STRING" }
                    }
                }
            };

            const results = await callGeminiAPI(systemPrompt, userQuery, schema);
            
            if (results) {
                resumeAnalysisResults = results;
            } 
            render(); 
        }
        
        async function validateJobInput() {
            const jobRoleInput = document.getElementById('job-role-input-job');
            const currentSkillsInput = document.getElementById('current-skills-input-job');
            
            const jobRole = jobRoleInput ? jobRoleInput.value.trim() : '';
            const skills = currentSkillsInput ? currentSkillsInput.value.trim() : '';
            
            let message = '';
            
            if (!jobRole && !skills) {
                message = 'Please enter a target <strong class="text-white font-semibold">Job Role</strong> and your <strong class="text-white font-semibold">Current Skills</strong> to get a career path analysis.';
            } else if (!jobRole) {
                message = 'Please enter your target <strong class="text-white font-semibold">Job Role</strong>. This is required for the analysis.';
            } else if (!isInputRelevant(jobRole)) { 
                message = 'The job role entered seems <strong class="text-white font-semibold">irrelevant or too vague</strong>. Please enter a proper job title (e.g., "Senior Data Analyst").';
            } else if (!skills) {
                message = 'Please enter your <strong class="text-white font-semibold">Current Skills</strong>. This is required for gap analysis.';
            }

            if (message) {
                validationMessage = message;
                render(); 
                return;
            }
            
            // Set loading state and navigate immediately to show loader
            isLoading = true;
            navigateTo(SCREENS.JOB_RESULTS);

            // Define API inputs (No changes here, already optimized)
            const systemPrompt = "You are an expert AI Career Coach focused on the Indian job market in 2025. A user provides a target job role and their current skills. Your response must be highly realistic and detailed, structured as three main sections. The content for 'skillsRequired' and 'careerGrowth' MUST be a single, richly formatted Markdown string containing paragraphs, bullet points, and headings (e.g., using ###) to establish a clear reading hierarchy.\n\n1. **skillsRequired**: Generate a single Markdown block explaining the absolutely ESSENTIAL skills for the role in the 2025 landscape. Include paragraphs on *why* these skills are critical, and a hierarchical list of core competencies. Emphasize **future-proofing** and **AI/Automation resilience**.\n\n2. **resources**: List specific, relevant learning resources (courses, books, tools) with a title and description for gaining the missing skills. Ensure these are high-quality, real-world relevant resources.\n\n3. **careerGrowth**: Generate a 1-year realistic career roadmap for students entering the tech field. Break the year into 3–4 phases (e.g., Month 1–3: Foundation, Month 4–6: Application, etc.) and outline logical skill progression, role transitions (e.g., Learner ➝ Intern), and salary expectations in relative terms (Low, Medium, High). Use short paragraphs and a clear, student-focused structure.\n\nYour entire response MUST strictly follow the JSON schema provided.";
            
            const userQuery = `
                My target job role is: ${jobRole}
                My current skills are: ${skills}
            `;
            
            const schema = {
                type: "OBJECT",
                properties: {
                    skillsRequired: {
                        type: "STRING" // Markdown string
                    },
                    resources: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                title: { type: "STRING" },
                                description: { type: "STRING" }
                            }
                        }
                    },
                    careerGrowth: {
                        type: "STRING" // Markdown string
                    }
                }
            };
            
            const results = await callGeminiAPI(systemPrompt, userQuery, schema);

            if (results) {
                jobAnalysisResults = results;
            }
            render(); 
        }

        // --- Components ---

        function Header(title, hasLogo = true) {
            return `
                <header class="flex justify-between items-center w-full mb-10">
                    <!-- Cleaned up logo container with only text -->
                    <div class="logo-container flex items-center space-x-3">
                        <h1 class="text-xl sm:text-2xl font-bold text-gray-200 tracking-wider">
                            ${title}
                        </h1>
                    </div>
                    <!-- About button -->
                    <button class="glowing-box text-sm sm:text-base font-medium text-gray-200 py-2 px-6 rounded-full haptic-button" onclick="openModal('about-modal')">
                        About
                    </button>
                </header>
            `;
        }

        function HomeScreen() {
            return `
                ${Header('AI Career Coach')}
                <main class="flex-grow flex flex-col items-center justify-center text-center mt-16 sm:mt-24">
                    <!-- Title: Analyze. Adapt. Achieve. -->
                    <div class="mb-16">
                        <h2 class="text-5xl sm:text-7xl lg:text-8xl font-extrabold leading-tight tracking-tighter">
                            <span class="text-orange-500 block">Analyze.</span>
                            <span class="text-gray-200 block">Adapt.</span>
                            <span class="text-orange-500 block">Achieve.</span>
                        </h2>
                    </div>

                    <!-- Action Buttons -->
                    <div class="flex flex-col sm:flex-row space-y-8 sm:space-y-0 sm:space-x-12 w-full justify-center">
                        
                        <!-- Resume Based Button -->
                        <button class="action-button glowing-box haptic-button" onclick="navigateTo(SCREENS.RESUME_INPUT)">
                            Resume Based
                        </button>
                        
                        <!-- Job Based Button -->
                        <button class="action-button glowing-box haptic-button" onclick="navigateTo(SCREENS.JOB_INPUT)">
                            Job Based
                        </button>
                    </div>
                </main>
            `;
        }
        
        function InlineValidationMessage() {
            if (validationMessage) {
                return `
                    <div class="bg-red-900 bg-opacity-30 border border-red-700 text-red-300 p-3 rounded-xl mb-6 text-sm text-center">
                        <p>${validationMessage}</p>
                    </div>
                `;
            }
            return '';
        }
        
        function LoadingSpinner() {
            return `
                <div class="flex justify-center items-center py-16">
                    <span class="loader"></span>
                </div>
            `;
        }

        function ResumeInputScreen() {
            return `
                ${Header('AI Career Coach')}
                <main class="flex justify-center items-start pt-8">
                    <div class="w-full max-w-2xl">
                        <!-- Main Card -->
                        <div class="glowing-box p-8 sm:p-12 rounded-[30px] transition-all duration-300">
                            <h2 class="text-3xl font-bold text-orange-500 mb-2">Drop Your Resume</h2>
                            <p class="text-gray-400 mb-8 text-sm leading-relaxed">
                                Drop your resume below and let scan it for skills, keywords, and opportunities.
                            </p>
                            
                            ${InlineValidationMessage()}

                            <!-- File Upload Area -->
                            <div class="mb-8">
                                <div class="flex flex-col sm:flex-row items-center sm:space-x-6 space-y-4 sm:space-y-0">
                                    <button 
                                        id="choose-file-btn" 
                                        class="glowing-box py-3 px-8 text-base font-semibold text-white rounded-xl hover:bg-orange-900 transition-colors duration-300 w-full sm:w-auto haptic-button"
                                    >
                                        Choose File
                                    </button>
                                    <input type="file" id="file-input" accept=".pdf" class="hidden"/>
                                    
                                    <div>
                                        <p class="text-sm font-medium text-gray-300">Supported formats: PDF</p>
                                        <p class="text-sm font-medium text-gray-300">Maximum size: 5MB</p>
                                    </div>
                                </div>
                                <!-- File Name Display -->
                                <p id="file-name-display" class="text-center sm:text-left text-green-400 text-sm mt-4 h-5">
                                    ${selectedFile ? selectedFile.name : ''}
                                </p>
                            </div>


                            <!-- Input Fields and Next Button (Grid for alignment) -->
                            <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 items-end">
                                <!-- Enter Job Role -->
                                <div class="col-span-3 sm:col-span-1">
                                    <input type="text" id="job-role-input" placeholder="Enter Job Role" class="glowing-input" />
                                </div>
                                
                                <!-- Enter Feedback (Optional) -->
                                <div class="col-span-3 sm:col-span-1">
                                    <p class="text-xs text-gray-500 font-medium mb-1 text-center sm:text-left"> (Optional Focus) </p>
                                    <input type="text" id="feedback-input" placeholder="e.g., focus on AI skills" class="glowing-input" />
                                </div>
                                
                                <!-- Next Button -->
                                <div class="col-span-3 sm:col-span-1 flex sm:justify-end">
                                    <button class="glowing-box py-3 px-10 text-lg font-semibold text-black bg-orange-500 rounded-xl hover:bg-orange-400 transition-colors duration-300 w-full sm:w-auto mt-2 sm:mt-0 haptic-button" onclick="validateResumeInput()">
                                        Next
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Back Button (Outside the box) -->
                        <div class="flex justify-center mt-6">
                            <button class="back-button haptic-button" onclick="navigateTo(SCREENS.HOME)">
                                Back to Home
                            </button>
                        </div>
                    </div>
                </main>
            `;
        }
        
        function JobInputScreen() {
            return `
                ${Header('AI Career Coach')}
                <main class="flex justify-center items-start pt-8">
                    <div class="w-full max-w-2xl">
                        <!-- Main Card -->
                        <div class="glowing-box p-8 sm:p-12 rounded-[30px] transition-all duration-300">
                            <h2 class="text-3xl font-bold text-orange-500 mb-2">Job Based Analysis</h2>
                            <p class="text-gray-400 mb-8 text-sm leading-relaxed">
                                Enter your target job role and your current skills to get a customized career roadmap.
                            </p>
                            
                            ${InlineValidationMessage()}

                            <!-- Input Fields and Next Button (Grid for alignment) -->
                            <div class="grid grid-cols-1 gap-6">
                                <!-- Enter Job Role -->
                                <div>
                                    <label class="block text-sm font-medium text-gray-300 mb-2" for="job-role-input-job">Target Job Role</label>
                                    <input type="text" id="job-role-input-job" placeholder="e.g., Senior Data Analyst" class="glowing-input" />
                                </div>
                                
                                <!-- Your Current Skills -->
                                <div>
                                    <label class="block text-sm font-medium text-gray-300 mb-2" for="current-skills-input-job">Your Current Skills</label>
                                    <textarea id="current-skills-input-job" placeholder="e.g., Python, SQL, Pandas, basic machine learning..." class="glowing-input" rows="4"></textarea>
                                </div>
                                
                                <!-- Next Button -->
                                <div class="flex justify-end mt-4">
                                    <button class="glowing-box py-3 px-10 text-lg font-semibold text-black bg-orange-500 rounded-xl hover:bg-orange-400 transition-colors duration-300 w-full sm:w-auto haptic-button" onclick="validateJobInput()">
                                        Next
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Back Button (Outside the box) -->
                        <div class="flex justify-center mt-6">
                            <button class="back-button haptic-button" onclick="navigateTo(SCREENS.HOME)">
                                Back to Home
                            </button>
                        </div>
                    </div>
                </main>
            `;
        }
        
        function ResumeResultsScreen() {
            function getTabContent(tab) {
                if (isLoading) {
                    return LoadingSpinner();
                }
                 if (validationMessage) {
                    return InlineValidationMessage();
                }
                if (!resumeAnalysisResults) { 
                    return '<p class="text-gray-400">Analysis complete. Waiting for data...</p>';
                }
                
                switch (tab) {
                    case 'atsScore':
                        if (!resumeAnalysisResults.atsScore) {
                             return '<p class="text-gray-400">ATS Score data is not available.</p>';
                        }
                        const scoreColor = resumeAnalysisResults.atsScore.score >= 7 ? 'text-green-400' : (resumeAnalysisResults.atsScore.score >= 4 ? 'text-yellow-400' : 'text-red-400');
                        return `
                            <div class="text-center">
                                <p class="text-7xl font-bold ${scoreColor}">${resumeAnalysisResults.atsScore.score}<span class="text-4xl text-gray-400">/10</span></p>
                                <p class="text-gray-300 mt-6 text-base leading-relaxed">${resumeAnalysisResults.atsScore.explanation}</p>
                            </div>
                        `;
                    case 'improvements':
                        return formatArrayAsList(resumeAnalysisResults.resumeImprovements);
                    case 'suggestions':
                        return formatArrayAsList(resumeAnalysisResults.suggestions);
                    default:
                        return '';
                }
            }
            
            return `
                ${Header('AI Career Coach')}
                <main class="flex justify-center items-start pt-8">
                    <div class="w-full max-w-4xl">
                        <!-- Main Card -->
                        <div class="glowing-box p-6 sm:p-10 rounded-[30px] transition-all duration-300">
                            
                            <!-- Tab Navigation Wrapper (3 sections) -->
                            <div class="flex flex-col sm:flex-row justify-between items-center mb-6 space-y-4 sm:space-y-0 sm:space-x-4">
                                <button class="tab-button w-full sm:w-auto ${activeTab === 'atsScore' ? 'active' : ''} haptic-button" onclick="setActiveTab('atsScore')">
                                    ATS Score
                                </button>
                                <button class="tab-button w-full sm:w-auto ${activeTab === 'improvements' ? 'active' : ''} haptic-button" onclick="setActiveTab('improvements')">
                                    Improvements
                                </button>
                                <button class="tab-button w-full sm:w-auto ${activeTab === 'suggestions' ? 'active' : ''} haptic-button" onclick="setActiveTab('suggestions')">
                                    Suggestions
                                </button>
                            </div>

                            <!-- Analysis Content Area -->
                            <div class="pt-4 min-h-[200px]">
                                ${getTabContent(activeTab)}
                            </div>
                        </div>

                        <!-- Back Button (Outside the box) -->
                        <div class="flex justify-center mt-6">
                            <button class="back-button haptic-button" onclick="navigateTo(SCREENS.RESUME_INPUT)">
                                Go Back
                            </button>
                        </div>
                    </div>
                </main>
            `;
        }

        function JobResultsScreen() {
            function getTabContent(tab) {
                if (isLoading) {
                    return LoadingSpinner();
                }
                 if (validationMessage) {
                    return InlineValidationMessage();
                }
                if (!jobAnalysisResults) { 
                    return '<p class="text-gray-400">Analysis complete. Waiting for data...</p>';
                }
                
                switch (tab) {
                    case 'skills_required':
                        return `
                            <div class="text-gray-300 leading-relaxed">
                                ${simpleMarkdownToHtml(jobAnalysisResults.skillsRequired)}
                            </div>
                        `;
                    case 'resources':
                        return formatResourceList(jobAnalysisResults.resources);
                    case 'careerGrowth':
                        return `
                            <div class="text-gray-300 leading-relaxed">
                                ${simpleMarkdownToHtml(jobAnalysisResults.careerGrowth)}
                            </div>
                        `;
                    default:
                        return '';
                }
            }
            
            return `
                ${Header('AI Career Coach')}
                <main class="flex justify-center items-start pt-8">
                    <div class="w-full max-w-4xl">
                        <!-- Main Card -->
                        <div class="glowing-box p-6 sm:p-10 rounded-[30px] transition-all duration-300">
                            
                            <!-- Tab Navigation Wrapper -->
                            <div class="flex flex-col sm:flex-row justify-between items-center mb-6 space-y-4 sm:space-y-0 sm:space-x-4">
                                <button class="tab-button w-full sm:w-auto ${activeTab === 'skills_required' ? 'active' : ''} haptic-button" onclick="setActiveTab('skills_required')">
                                    Skills Required
                                </button>
                                <button class="tab-button w-full sm:w-auto ${activeTab === 'resources' ? 'active' : ''} haptic-button" onclick="setActiveTab('resources')">
                                    Resources
                                </button>
                                <button class="tab-button w-full sm:w-auto ${activeTab === 'careerGrowth' ? 'active' : ''} haptic-button" onclick="setActiveTab('careerGrowth')">
                                    Career Growth
                                </button>
                            </div>

                            <!-- Analysis Content Area -->
                            <div class="pt-4 min-h-[200px]">
                                ${getTabContent(activeTab)}
                            </div>
                        </div>

                        <!-- Back Button (Outside the box) -->
                        <div class="flex justify-center mt-6">
                            <button class="back-button haptic-button" onclick="navigateTo(SCREENS.JOB_INPUT)">
                                Go Back
                            </button>
                        </div>
                    </div>
                </main>
            `;
        }

        // --- Render Loop ---

        function render() {
            let content = '';
            // Store the current message before clearing the state for the next screen render
            const persistentMessage = validationMessage;
            validationMessage = ''; 

            switch (currentScreen) {
                case SCREENS.HOME:
                    content = HomeScreen();
                    break;
                case SCREENS.RESUME_INPUT:
                    validationMessage = persistentMessage; // Restore message if returning to this screen
                    content = ResumeInputScreen();
                    break;
                case SCREENS.JOB_INPUT:
                     validationMessage = persistentMessage; // Restore message if returning to this screen
                    content = JobInputScreen();
                    break;
                case SCREENS.RESUME_RESULTS:
                    validationMessage = persistentMessage;
                    content = ResumeResultsScreen();
                    break;
                case SCREENS.JOB_RESULTS:
                     validationMessage = persistentMessage;
                    content = JobResultsScreen();
                    break;
                default:
                    content = HomeScreen();
            }

            appDiv.innerHTML = content;

            // Add event listeners specific to the rendered screen
            if (currentScreen === SCREENS.RESUME_INPUT) {
                addResumeInputListeners();
            }
        }

        /**
         * Adds event listeners for the Resume Input screen after it renders.
         */
        function addResumeInputListeners() {
            const fileInput = document.getElementById('file-input');
            const chooseFileBtn = document.getElementById('choose-file-btn');
            const fileNameDisplay = document.getElementById('file-name-display');

            if (chooseFileBtn) {
                chooseFileBtn.onclick = () => {
                    fileInput.click();
                };
            }

            if (fileInput) {
                fileInput.onchange = (e) => {
                    if (e.target.files.length > 0) {
                        selectedFile = e.target.files[0];
                        if (fileNameDisplay) {
                            fileNameDisplay.textContent = selectedFile.name;
                        }
                        
                        // --- File Selection Feedback ---
                        // Show success feedback on the button itself briefly
                        const originalText = chooseFileBtn.textContent;
                        const originalClasses = chooseFileBtn.className;

                        chooseFileBtn.textContent = 'File Selected!';
                        chooseFileBtn.classList.remove('bg-orange-500', 'hover:bg-orange-400', 'text-white');
                        chooseFileBtn.classList.add('bg-green-600', 'hover:bg-green-500', 'text-white');

                        setTimeout(() => {
                            chooseFileBtn.textContent = originalText;
                            chooseFileBtn.className = originalClasses;
                        }, 1000); // Revert after 1 second
                        // --- End Feedback ---

                        // Clear validation message if file is selected
                        if (validationMessage) {
                            validationMessage = '';
                            render(); // Re-render to clear validation
                        }
                    }
                };
            }
        }

        // Initial render
        render();

        // Add a generic button style for the Home screen buttons 
        document.addEventListener('DOMContentLoaded', () => {
            const style = document.createElement('style');
            style.textContent = `
                .action-button {
                    background-color: #1a1a1a;
                    color: #ffffff;
                    font-size: 1.125rem;
                    font-weight: 500;
                    padding: 1rem 3rem;
                    border-radius: 1.5rem;
                    width: 100%;
                    max-width: 300px;
                    text-align: center;
                }
            `;
            document.head.appendChild(style);
        });
