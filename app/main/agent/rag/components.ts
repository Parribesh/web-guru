// Component Extraction - Identifies functional DOM components

import { DOMComponent, ComponentType } from '../../../shared/types';
import { eventLogger } from '../../logging/event-logger';

/**
 * Find semantic context around a form (heading, nearby text) to understand form purpose
 */
function findFormContext(formHtml: string, htmlContent: string, formId: string): {
  heading?: string;
  description?: string;
  purpose?: string;
} {
  const context: { heading?: string; description?: string; purpose?: string } = {};
  
  // Find the form's position in the HTML
  const formPosition = htmlContent.indexOf(formHtml);
  if (formPosition === -1) return context;
  
  // Look for heading before the form (within 500 chars)
  const beforeForm = htmlContent.substring(Math.max(0, formPosition - 500), formPosition);
  const headingMatch = beforeForm.match(/<(h[1-6])[^>]*>([^<]+)<\/h[1-6]>/i);
  if (headingMatch) {
    context.heading = headingMatch[2].trim();
  }
  
  // Look for description text before form (paragraphs, divs with text)
  const descMatch = beforeForm.match(/<(p|div)[^>]*>([^<]{20,200})<\/[pd]>/i);
  if (descMatch) {
    context.description = descMatch[2].trim();
  }
  
  // Infer purpose from form ID, name, or action
  const formIdLower = formId.toLowerCase();
  const formNameMatch = formHtml.match(/name=["']([^"']+)["']/i);
  const formName = formNameMatch ? formNameMatch[1].toLowerCase() : '';
  const formActionMatch = formHtml.match(/action=["']([^"']+)["']/i);
  const formAction = formActionMatch ? formActionMatch[1].toLowerCase() : '';
  
  // Infer purpose from common patterns
  if (formIdLower.includes('book') || formName.includes('book') || formAction.includes('book')) {
    context.purpose = 'booking form';
  } else if (formIdLower.includes('contact') || formName.includes('contact') || formAction.includes('contact')) {
    context.purpose = 'contact form';
  } else if (formIdLower.includes('login') || formName.includes('login') || formAction.includes('login')) {
    context.purpose = 'login form';
  } else if (formIdLower.includes('register') || formName.includes('register') || formAction.includes('register')) {
    context.purpose = 'registration form';
  } else if (formIdLower.includes('search') || formName.includes('search') || formAction.includes('search')) {
    context.purpose = 'search form';
  } else if (formIdLower.includes('subscribe') || formName.includes('subscribe') || formAction.includes('subscribe')) {
    context.purpose = 'subscription form';
  }
  
  return context;
}

/**
 * Generate semantic description from form fields
 */
function generateFormSemanticDescription(inputs: DOMComponent[], buttons: DOMComponent[]): string {
  const fieldDescriptions: string[] = [];
  
  inputs.forEach(input => {
    const label = input.metadata.label || input.attributes.placeholder || input.attributes.name || '';
    const type = input.attributes.type || 'text';
    
    if (label) {
      // Create natural language description
      if (type === 'email') {
        fieldDescriptions.push(`email address field for ${label.toLowerCase()}`);
      } else if (type === 'password') {
        fieldDescriptions.push(`password field`);
      } else if (type === 'date') {
        fieldDescriptions.push(`date field for ${label.toLowerCase()}`);
      } else if (type === 'number' || type === 'tel') {
        fieldDescriptions.push(`number field for ${label.toLowerCase()}`);
      } else {
        fieldDescriptions.push(`${label.toLowerCase()} field`);
      }
    }
  });
  
  // Infer form purpose from field types and labels
  const allLabels = inputs.map(i => 
    (i.metadata.label || i.attributes.placeholder || i.attributes.name || '').toLowerCase()
  ).join(' ');
  
  let inferredPurpose = '';
  if (allLabels.includes('name') && allLabels.includes('email') && allLabels.includes('date')) {
    inferredPurpose = 'booking or reservation form';
  } else if (allLabels.includes('name') && allLabels.includes('email') && allLabels.includes('message')) {
    inferredPurpose = 'contact form';
  } else if (allLabels.includes('username') && allLabels.includes('password')) {
    inferredPurpose = 'login or authentication form';
  } else if (allLabels.includes('email') && inputs.some(i => i.attributes.type === 'email')) {
    inferredPurpose = 'email subscription or contact form';
  } else if (allLabels.includes('search') || allLabels.includes('query')) {
    inferredPurpose = 'search form';
  }
  
  return inferredPurpose || fieldDescriptions.join(', ') || 'form with input fields';
}

/**
 * Extract all interactive components from HTML content
 */
export function extractComponents(htmlContent: string, textContent: string): DOMComponent[] {
  const components: DOMComponent[] = [];
  
  // We'll parse HTML to extract components
  // For now, we'll use a simple approach - in production you might want to use a proper HTML parser
  
  // Extract forms
  const formRegex = /<form[^>]*>([\s\S]*?)<\/form>/gi;
  let formMatch;
  let formIndex = 0;
  
  while ((formMatch = formRegex.exec(htmlContent)) !== null) {
    const formHtml = formMatch[0];
    const formId = extractAttribute(formHtml, 'id') || `form-${formIndex++}`;
    const formName = extractAttribute(formHtml, 'name') || '';
    const formAction = extractAttribute(formHtml, 'action') || '';
    const formMethod = extractAttribute(formHtml, 'method') || 'get';
    
    // Extract inputs within this form
    const inputRegex = /<input[^>]*>/gi;
    const inputs: DOMComponent[] = [];
    let inputMatch;
    
    while ((inputMatch = inputRegex.exec(formHtml)) !== null) {
      const inputHtml = inputMatch[0];
      const inputId = extractAttribute(inputHtml, 'id') || '';
      const inputName = extractAttribute(inputHtml, 'name') || '';
      const inputType = extractAttribute(inputHtml, 'type') || 'text';
      const inputPlaceholder = extractAttribute(inputHtml, 'placeholder') || '';
      const inputRequired = inputHtml.includes('required');
      const inputLabel = findLabelForInput(inputId, inputName, htmlContent);
      
      const inputSelector = inputId ? `#${inputId}` : inputName ? `[name="${inputName}"]` : '';
      
      if (inputSelector) {
        const inputComponent: DOMComponent = {
          type: 'input-group',
          id: `input-${formId}-${inputName || inputId || inputs.length}`,
          selector: inputSelector,
          attributes: {
            id: inputId,
            name: inputName,
            type: inputType,
            placeholder: inputPlaceholder,
            required: inputRequired ? 'true' : 'false',
          },
          textContent: inputLabel || inputPlaceholder || inputName || inputType,
          metadata: {
            isInteractive: true,
            formId: formId,
            inputType: inputType,
            label: inputLabel,
            placeholder: inputPlaceholder,
            required: inputRequired,
            parentId: formId,
          },
        };
        inputs.push(inputComponent);
        components.push(inputComponent);
      }
    }
    
    // Extract submit buttons within this form
    // Match both <button> and <input type="submit"> elements
    const buttonRegex = /<(button|input)[^>]*>([\s\S]*?)<\/(button|input)>|<input[^>]*type=["'](submit|button)["'][^>]*\/?>/gi;
    let buttonMatch;
    let buttonIndex = 0;
    
    while ((buttonMatch = buttonRegex.exec(formHtml)) !== null) {
      const buttonHtml = buttonMatch[0];
      const buttonType = extractAttribute(buttonHtml, 'type');
      
      // Only process submit/button types
      if (buttonType !== 'submit' && buttonType !== 'button' && !buttonHtml.includes('type="submit"') && !buttonHtml.includes("type='submit'")) {
        continue;
      }
      
      const buttonId = extractAttribute(buttonHtml, 'id') || '';
      const buttonName = extractAttribute(buttonHtml, 'name') || '';
      const buttonValue = extractAttribute(buttonHtml, 'value') || '';
      const buttonText = extractTextContent(buttonHtml) || buttonValue || 'Submit';
      const buttonSelector = buttonId ? `#${buttonId}` : buttonName ? `[name="${buttonName}"]` : `button[type="submit"]:nth-of-type(${buttonIndex + 1})`;
      
      const buttonComponent: DOMComponent = {
        type: 'button',
        id: `button-${formId}-${buttonId || buttonName || buttonIndex++}`,
        selector: buttonSelector,
        attributes: {
          id: buttonId,
          name: buttonName,
          type: buttonType || 'submit',
        },
        textContent: buttonText,
        metadata: {
          isInteractive: true,
          formId: formId,
          parentId: formId,
        },
      };
      components.push(buttonComponent);
    }
    
    // Find semantic context for this form
    const formContext = findFormContext(formHtml, htmlContent, formId);
    const formButtons = components.filter(c => c.metadata.formId === formId && c.type === 'button');
    const semanticDescription = generateFormSemanticDescription(inputs, formButtons);
    
    // Create enhanced text content with semantic information
    let formText = extractTextContent(formHtml);
    if (formContext.heading) {
      formText = `${formContext.heading} - ${formText}`;
    }
    if (formContext.purpose) {
      formText = `${formContext.purpose}: ${formText}`;
    } else if (semanticDescription) {
      formText = `${semanticDescription}: ${formText}`;
    }
    if (!formText || formText.trim().length < 10) {
      formText = formContext.purpose || semanticDescription || `Form with ${inputs.length} input field(s)`;
    }
    
    const formComponent: DOMComponent = {
      type: 'form',
      id: formId,
      selector: `#${formId}` || `form[name="${formName}"]` || `form[action="${formAction}"]`,
      attributes: {
        id: formId,
        name: formName,
        action: formAction,
        method: formMethod,
      },
      textContent: formText,
      metadata: {
        isInteractive: true,
        children: inputs.map(i => i.id).concat(
          formButtons.map(b => b.id)
        ),
        // Store semantic context for embedding
        formPurpose: formContext.purpose || semanticDescription,
        formHeading: formContext.heading,
        formDescription: formContext.description,
      },
    };
    components.push(formComponent);
  }
  
  // Extract standalone buttons (not in forms)
  const standaloneButtonRegex = /<button[^>]*>([\s\S]*?)<\/button>/gi;
  let standaloneButtonMatch;
  let buttonIndex = 0;
  
  while ((standaloneButtonMatch = standaloneButtonRegex.exec(htmlContent)) !== null) {
    const buttonHtml = standaloneButtonMatch[0];
    // Skip if already captured in a form
    if (components.some(c => buttonHtml.includes(c.attributes.id || ''))) {
      continue;
    }
    
    const buttonId = extractAttribute(buttonHtml, 'id') || `button-standalone-${buttonIndex++}`;
    const buttonText = extractTextContent(buttonHtml) || 'Button';
    const buttonSelector = buttonId.startsWith('button-standalone-') 
      ? `button:nth-of-type(${buttonIndex})` 
      : `#${buttonId}`;
    
    const buttonComponent: DOMComponent = {
      type: 'button',
      id: buttonId,
      selector: buttonSelector,
      attributes: {
        id: buttonId,
      },
      textContent: buttonText,
      metadata: {
        isInteractive: true,
      },
    };
    components.push(buttonComponent);
  }
  
  // Extract tables
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  let tableIndex = 0;
  
  while ((tableMatch = tableRegex.exec(htmlContent)) !== null) {
    const tableHtml = tableMatch[0];
    const tableId = extractAttribute(tableHtml, 'id') || `table-${tableIndex++}`;
    const tableText = extractTableText(tableHtml);
    const tableSelector = tableId.startsWith('table-') 
      ? `table:nth-of-type(${tableIndex})` 
      : `#${tableId}`;
    
    const tableComponent: DOMComponent = {
      type: 'table',
      id: tableId,
      selector: tableSelector,
      attributes: {
        id: tableId,
      },
      textContent: tableText,
      metadata: {
        isInteractive: false,
      },
    };
    components.push(tableComponent);
  }
  
  eventLogger.info('Component Extraction', `Extracted ${components.length} components (${components.filter(c => c.type === 'form').length} forms, ${components.filter(c => c.type === 'button').length} buttons, ${components.filter(c => c.type === 'table').length} tables)`);
  
  return components;
}

// Helper functions
function extractAttribute(html: string, attr: string): string {
  const regex = new RegExp(`${attr}=["']([^"']+)["']`, 'i');
  const match = html.match(regex);
  return match ? match[1] : '';
}

function extractTextContent(html: string): string {
  // Remove HTML tags and get text content
  return html.replace(/<[^>]+>/g, '').trim();
}

function findLabelForInput(inputId: string, inputName: string, htmlContent: string): string {
  // Try to find associated label
  if (inputId) {
    const labelRegex = new RegExp(`<label[^>]*for=["']${inputId}["'][^>]*>([\\s\\S]*?)<\\/label>`, 'i');
    const match = htmlContent.match(labelRegex);
    if (match) {
      return extractTextContent(match[1]);
    }
  }
  
  // Try to find preceding label
  const precedingLabelRegex = /<label[^>]*>([\s\S]*?)<\/label>\s*<input[^>]*(id|name)=["'](inputId|inputName)["']/i;
  const match = htmlContent.match(precedingLabelRegex);
  if (match) {
    return extractTextContent(match[1]);
  }
  
  return '';
}

function extractTableText(tableHtml: string): string {
  const rows: string[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    const cellRegex = /<(th|td)[^>]*>([\s\S]*?)<\/(th|td)>/gi;
    let cellMatch;
    
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      const cellText = extractTextContent(cellMatch[2]);
      if (cellText) {
        cells.push(cellText);
      }
    }
    
    if (cells.length > 0) {
      rows.push(cells.join(' | '));
    }
  }
  
  return rows.join('\n');
}

