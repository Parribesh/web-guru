// DOM Interaction Tools for the Agent System

import { BrowserView } from 'electron';
import { eventLogger } from '../logging/event-logger';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      required?: boolean;
    }>;
    required?: string[];
  };
}

// ToolCall and ToolResult are defined in types.ts
import { ToolCall, ToolResult } from './types';

// Available tools for DOM interaction
export const DOM_TOOLS: ToolDefinition[] = [
  {
    name: 'fillInput',
    description: 'Fill a form input field with a value. Use the field label, placeholder, id, or name to identify it.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector, field label, placeholder text, id, or name attribute to identify the input field',
        },
        value: {
          type: 'string',
          description: 'The value to fill into the input field',
        },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'clickButton',
    description: 'Click a button on the page. Use button text, id, class, or other attributes to identify it.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector, button text, id, class, or other attribute to identify the button',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'selectOption',
    description: 'Select an option in a dropdown/select element.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector, label, id, or name to identify the select element',
        },
        value: {
          type: 'string',
          description: 'The value or text of the option to select',
        },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'submitForm',
    description: 'Submit a form on the page. Can use form id, class, or find form containing a specific element.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the form, or selector for an element within the form',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'waitForElement',
    description: 'Wait for an element to appear on the page before proceeding.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector for the element to wait for',
        },
        timeout: {
          type: 'number',
          description: 'Maximum time to wait in milliseconds (default: 5000)',
        },
      },
      required: ['selector'],
    },
  },
];

// Execute a tool call on a BrowserView
export async function executeTool(
  toolCall: ToolCall,
  browserView: BrowserView
): Promise<ToolResult> {
  const startTime = Date.now();
  eventLogger.info('Tool Execution', `Executing tool: ${toolCall.name} with params: ${JSON.stringify(toolCall.params)}`);

  try {
    let result: any;

    switch (toolCall.name) {
      case 'fillInput':
        result = await executeFillInput(browserView, toolCall.params);
        break;
      case 'clickButton':
        result = await executeClickButton(browserView, toolCall.params);
        break;
      case 'selectOption':
        result = await executeSelectOption(browserView, toolCall.params);
        break;
      case 'submitForm':
        result = await executeSubmitForm(browserView, toolCall.params);
        break;
      case 'waitForElement':
        result = await executeWaitForElement(browserView, toolCall.params);
        break;
      default:
        throw new Error(`Unknown tool: ${toolCall.name}`);
    }

    const duration = Date.now() - startTime;
    eventLogger.success('Tool Execution', `Tool ${toolCall.name} completed in ${duration}ms`);
    
    return {
      toolCallId: toolCall.id,
      success: true,
      result,
      timestamp: Date.now(),
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    eventLogger.error('Tool Execution', `Tool ${toolCall.name} failed after ${duration}ms`, error.message || error);
    
    return {
      toolCallId: toolCall.id,
      success: false,
      error: error.message || 'Unknown error',
      timestamp: Date.now(),
    };
  }
}

async function executeFillInput(browserView: BrowserView, params: Record<string, any>): Promise<any> {
  const selector = params.selector as string;
  const value = params.value as string;
  if (!selector || !value) {
    throw new Error('fillInput requires selector and value parameters');
  }
  
  const script = `
    (function() {
      const selector = ${JSON.stringify(selector)};
      const value = ${JSON.stringify(value)};
      
      // Try to find element by various methods
      let element = null;
      
      // First try CSS selector
      try {
        element = document.querySelector(selector);
      } catch (e) {}
      
      // If not found, try by label text
      if (!element) {
        const labels = Array.from(document.querySelectorAll('label'));
        const matchingLabel = labels.find(label => 
          label.textContent.toLowerCase().includes(selector.toLowerCase())
        );
        if (matchingLabel && matchingLabel.htmlFor) {
          element = document.getElementById(matchingLabel.htmlFor);
        }
      }
      
      // If not found, try by placeholder
      if (!element) {
        element = Array.from(document.querySelectorAll('input, textarea, select')).find((el: any) =>
          el.placeholder && el.placeholder.toLowerCase().includes(selector.toLowerCase())
        );
      }
      
      // If not found, try by id or name
      if (!element) {
        element = document.getElementById(selector) || document.querySelector(\`[name="\${selector}"]\`);
      }
      
      if (!element) {
        throw new Error(\`Input field not found: \${selector}\`);
      }
      
      // Focus and fill the input
      element.focus();
      element.value = value;
      
      // Trigger input events
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      
      return {
        success: true,
        element: {
          tagName: element.tagName,
          id: element.id || null,
          name: (element as any).name || null,
          type: (element as any).type || null,
        },
        value: element.value
      };
    })();
  `;

  const result = await browserView.webContents.executeJavaScript(script);
  return result;
}

async function executeClickButton(browserView: BrowserView, params: Record<string, any>): Promise<any> {
  const selector = params.selector as string;
  if (!selector) {
    throw new Error('clickButton requires selector parameter');
  }
  
  const script = `
    (function() {
      const selector = ${JSON.stringify(selector)};
      
      // Try to find button by various methods
      let element = null;
      
      // First try CSS selector
      try {
        element = document.querySelector(selector);
      } catch (e) {}
      
      // If not found, try by button text
      if (!element) {
        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a[role="button"]'));
        element = buttons.find((btn: any) => 
          btn.textContent && btn.textContent.toLowerCase().includes(selector.toLowerCase())
        );
      }
      
      // If not found, try by id or class
      if (!element) {
        element = document.getElementById(selector) || document.querySelector(\`[class*="\${selector}"]\`);
      }
      
      if (!element) {
        throw new Error(\`Button not found: \${selector}\`);
      }
      
      // Click the button
      element.click();
      
      return {
        success: true,
        element: {
          tagName: element.tagName,
          textContent: element.textContent?.trim() || null,
          id: element.id || null,
        }
      };
    })();
  `;

  const result = await browserView.webContents.executeJavaScript(script);
  return result;
}

async function executeSelectOption(browserView: BrowserView, params: Record<string, any>): Promise<any> {
  const selector = params.selector as string;
  const value = params.value as string;
  if (!selector || !value) {
    throw new Error('selectOption requires selector and value parameters');
  }
  
  const script = `
    (function() {
      const selector = ${JSON.stringify(selector)};
      const value = ${JSON.stringify(value)};
      
      // Try to find select element
      let element = null;
      
      // First try CSS selector
      try {
        element = document.querySelector(selector);
      } catch (e) {}
      
      // If not found, try by label
      if (!element) {
        const labels = Array.from(document.querySelectorAll('label'));
        const matchingLabel = labels.find(label => 
          label.textContent.toLowerCase().includes(selector.toLowerCase())
        );
        if (matchingLabel && matchingLabel.htmlFor) {
          element = document.getElementById(matchingLabel.htmlFor);
        }
      }
      
      // If not found, try by id or name
      if (!element) {
        element = document.getElementById(selector) || document.querySelector(\`[name="\${selector}"]\`);
      }
      
      if (!element || element.tagName !== 'SELECT') {
        throw new Error(\`Select element not found: \${selector}\`);
      }
      
      const select = element as HTMLSelectElement;
      
      // Try to find option by value or text
      let option = Array.from(select.options).find((opt: any) => 
        opt.value === value || opt.textContent.toLowerCase().includes(value.toLowerCase())
      );
      
      if (!option) {
        throw new Error(\`Option not found: \${value}\`);
      }
      
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      
      return {
        success: true,
        element: {
          id: select.id || null,
          name: select.name || null,
        },
        selectedValue: select.value,
        selectedText: option.textContent
      };
    })();
  `;

  const result = await browserView.webContents.executeJavaScript(script);
  return result;
}

async function executeSubmitForm(browserView: BrowserView, params: Record<string, any>): Promise<any> {
  const selector = params.selector as string;
  if (!selector) {
    throw new Error('submitForm requires selector parameter');
  }
  
  const script = `
    (function() {
      const selector = ${JSON.stringify(selector)};
      
      // Try to find form
      let form = null;
      
      // First try CSS selector
      try {
        form = document.querySelector(selector);
        if (form && form.tagName !== 'FORM') {
          // If element is inside a form, get the form
          form = form.closest('form');
        }
      } catch (e) {}
      
      // If not found, try by id or name
      if (!form) {
        form = document.getElementById(selector) || document.querySelector(\`form[name="\${selector}"]\`);
      }
      
      if (!form || form.tagName !== 'FORM') {
        throw new Error(\`Form not found: \${selector}\`);
      }
      
      // Submit the form
      form.submit();
      
      return {
        success: true,
        formId: form.id || null,
        formName: (form as any).name || null,
      };
    })();
  `;

  const result = await browserView.webContents.executeJavaScript(script);
  return result;
}

async function executeWaitForElement(browserView: BrowserView, params: Record<string, any>): Promise<any> {
  const selector = params.selector as string;
  const timeout = (params.timeout as number) || 5000;
  if (!selector) {
    throw new Error('waitForElement requires selector parameter');
  }
  
  const script = `
    (function() {
      return new Promise((resolve, reject) => {
        const selector = ${JSON.stringify(selector)};
        const timeout = ${timeout};
        const startTime = Date.now();
        
        function check() {
          try {
            const element = document.querySelector(selector);
            if (element) {
              resolve({
                success: true,
                found: true,
                element: {
                  tagName: element.tagName,
                  id: element.id || null,
                }
              });
            } else if (Date.now() - startTime > timeout) {
              resolve({
                success: false,
                found: false,
                error: 'Timeout waiting for element'
              });
            } else {
              setTimeout(check, 100);
            }
          } catch (e) {
            reject(e);
          }
        }
        
        check();
      });
    })();
  `;

  const result = await browserView.webContents.executeJavaScript(script, true);
  return result;
}

